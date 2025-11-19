import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform, stderr;
import 'package:http/http.dart' as http;

/// Client for interacting with Ollama local AI models.
///
/// Provides methods to generate text responses using models like Llama 3.1 70B.
/// Requires Ollama to be installed and running locally.
class LocalAIClient {
  /// Ollama server URL
  /// Auto-detects from OLLAMA_HOST environment variable or uses default
  final String ollamaUrl;

  /// Model to use (e.g., 'llama3.1:8b', 'codellama:13b', 'qwen2.5:14b')
  /// Default: codellama:13b - better for code understanding and instruction following
  /// Alternative: qwen2.5:14b for even better structured output (needs to be pulled)
  final String model;

  /// Temperature for generation (0.0 = deterministic, 1.0 = creative)
  final double temperature;

  /// Maximum tokens to generate
  final int maxTokens;

  LocalAIClient({
    String? ollamaUrl,
    this.model =
        'qwen2.5:32b', // Better for code tasks - improved instruction following
    this.temperature = 0.1, // Lower for more deterministic code validation
    this.maxTokens =
        128000, // More tokens for detailed architectural explanations
  }) : ollamaUrl = ollamaUrl ?? _detectOllamaUrl();

  /// Detects Ollama URL from environment or uses default
  static String _detectOllamaUrl() {
    // Check OLLAMA_HOST environment variable
    final envHost = String.fromEnvironment('OLLAMA_HOST',
        defaultValue: Platform.environment['OLLAMA_HOST'] ?? '');

    if (envHost.isNotEmpty) {
      // Ensure it has http:// prefix
      return envHost.startsWith('http') ? envHost : 'http://$envHost';
    }

    // Default to localhost:11434
    return 'http://localhost:11434';
  }

  /// Generates text from a prompt using Ollama.
  ///
  /// Example:
  /// ```dart
  /// final client = LocalAIClient();
  /// final response = await client.generate(
  ///   'Explain what a UseCase is in Clean Architecture'
  /// );
  /// print(response);
  /// ```
  Future<String> generate(
    String prompt, {
    double? temperature,
    int? maxTokens,
  }) async {
    try {
      final uri = Uri.parse('$ollamaUrl/api/generate');

      // Clean the prompt to avoid encoding issues
      final cleanedPrompt = prompt
          .replaceAll('\r\n', '\n') // Normalize line endings
          .replaceAll('\r', '\n'); // Normalize carriage returns

      final requestBody = jsonEncode({
        'model': model,
        'prompt': cleanedPrompt,
        'stream': false,
        'options': {
          'temperature': temperature ?? this.temperature,
          'num_predict': maxTokens ?? this.maxTokens,
        },
      });

      // Debug: Log request size
      stderr.writeln('🔍 DEBUG: Sending request to Ollama');
      stderr.writeln('   Model: $model');
      stderr.writeln('   Prompt length: ${cleanedPrompt.length} chars');
      stderr.writeln('   JSON body length: ${requestBody.length} bytes');

      // Validate JSON before sending
      try {
        jsonDecode(requestBody); // This will throw if JSON is invalid
        stderr.writeln('   ✓ JSON is valid');
      } catch (e) {
        stderr.writeln('   ✗ JSON validation failed: $e');
        throw AIClientException('Invalid JSON generated: $e');
      }

      stderr
          .writeln('   ⏳ Waiting for Ollama response (timeout: 5 minutes)...');
      stderr.writeln('   💡 Large prompts can take 40+ seconds to process...');
      final startTime = DateTime.now();

      // Use package:http for better reliability with large payloads
      final response = await http
          .post(
        uri,
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        body: requestBody,
      )
          .timeout(
        Duration(minutes: 5),
        onTimeout: () {
          throw AIClientException('Request timed out after 5 minutes. '
              'Try reducing prompt size or using a faster model.');
        },
      );

      final elapsed = DateTime.now().difference(startTime);
      stderr
          .writeln('   ✓ Response received after ${elapsed.inSeconds} seconds');

      stderr.writeln('📨 DEBUG: Response status: ${response.statusCode}');
      stderr.writeln('   Response body length: ${response.body.length} bytes');

      if (response.statusCode != 200) {
        stderr.writeln('❌ DEBUG: Error response body: ${response.body}');
        throw AIClientException(
          'Ollama API error: ${response.statusCode} - ${response.body}',
        );
      }

      final jsonResponse = jsonDecode(response.body) as Map<String, dynamic>;
      return jsonResponse['response'] as String;
    } on http.ClientException catch (e) {
      throw AIClientException(
        'Failed to connect to Ollama at $ollamaUrl. '
        'Is Ollama running? Error: ${e.message}',
      );
    } on TimeoutException {
      throw AIClientException('Request timed out after 5 minutes');
    } catch (e) {
      throw AIClientException('AI generation failed: $e');
    }
  }

  /// Generates structured feedback for a validation issue.
  ///
  /// This method formats the prompt specifically for validation feedback
  /// and parses the response into structured components.
  Future<AIFeedbackResponse> generateValidationFeedback({
    required String issueType,
    required String issueDescription,
    required String location,
    required String instructionContent,
  }) async {
    final prompt = _buildValidationPrompt(
      issueType: issueType,
      issueDescription: issueDescription,
      location: location,
      instructionContent: instructionContent,
    );

    final response = await generate(prompt);

    return _parseValidationFeedback(response);
  }

  String _buildValidationPrompt({
    required String issueType,
    required String issueDescription,
    required String location,
    required String instructionContent,
  }) {
    return '''
You are a code validation assistant helping another AI fix architectural issues.

ISSUE FOUND:
Type: $issueType
Description: $issueDescription
Location: $location

RELEVANT INSTRUCTIONS:
$instructionContent

YOUR TASK:
Generate structured feedback to help fix this issue. Provide:

1. WHAT IS WRONG: Clear explanation of the problem
2. WHY IT MATTERS: Architectural reasoning for this requirement
3. HOW TO FIX: Step-by-step instructions (numbered list)
4. EXAMPLE CODE: (Optional) A small code example showing correct implementation

Format your response EXACTLY like this:

WHAT: [explanation]

WHY: [reasoning]

FIX:
1. [first step]
2. [second step]
3. [third step]

EXAMPLE:
```dart
[optional code example]
```

Keep explanations concise and actionable for AI consumption.
''';
  }

  AIFeedbackResponse _parseValidationFeedback(String response) {
    // Extract sections using regex
    final whatMatch = RegExp(r'WHAT:\s*(.+?)(?=\n\nWHY:|\z)', dotAll: true)
        .firstMatch(response);
    final whyMatch = RegExp(r'WHY:\s*(.+?)(?=\n\nFIX:|\z)', dotAll: true)
        .firstMatch(response);
    final fixMatch = RegExp(r'FIX:\s*(.+?)(?=\n\nEXAMPLE:|\z)', dotAll: true)
        .firstMatch(response);
    final exampleMatch =
        RegExp(r'EXAMPLE:\s*```(?:dart)?\s*(.+?)\s*```', dotAll: true)
            .firstMatch(response);

    final what = whatMatch?.group(1)?.trim() ?? response.trim();
    final why = whyMatch?.group(1)?.trim() ?? 'See instructions for details';
    final fixSection = fixMatch?.group(1)?.trim() ?? '';
    final example = exampleMatch?.group(1)?.trim();

    // Parse fix steps (numbered list)
    final fixSteps = <String>[];
    final fixLines = fixSection.split('\n');
    for (final line in fixLines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;

      // Remove leading numbers and cleanup
      final cleaned = trimmed.replaceFirst(RegExp(r'^\d+\.\s*'), '');
      if (cleaned.isNotEmpty) {
        fixSteps.add(cleaned);
      }
    }

    return AIFeedbackResponse(
      whatIsWrong: what,
      whyItMatters: why,
      howToFix: fixSteps.isEmpty ? ['Apply fixes as described'] : fixSteps,
      exampleCode: example,
    );
  }

  /// Checks if Ollama is available and the model is installed.
  Future<bool> checkAvailability() async {
    try {
      final uri = Uri.parse('$ollamaUrl/api/tags');
      final response = await http.get(uri).timeout(Duration(seconds: 5));

      if (response.statusCode != 200) {
        return false;
      }

      final jsonResponse = jsonDecode(response.body) as Map<String, dynamic>;
      final models = jsonResponse['models'] as List?;

      if (models == null) return false;

      // Check if our model is available
      return models.any(
        (m) =>
            (m as Map<String, dynamic>)['name']?.toString().startsWith(model) ??
            false,
      );
    } catch (e) {
      return false;
    }
  }
}

/// Response from AI feedback generation
class AIFeedbackResponse {
  final String whatIsWrong;
  final String whyItMatters;
  final List<String> howToFix;
  final String? exampleCode;

  AIFeedbackResponse({
    required this.whatIsWrong,
    required this.whyItMatters,
    required this.howToFix,
    this.exampleCode,
  });
}

/// Exception thrown when AI client operations fail
class AIClientException implements Exception {
  final String message;

  AIClientException(this.message);

  @override
  String toString() => 'AIClientException: $message';
}
