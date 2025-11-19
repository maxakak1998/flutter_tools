import 'dart:convert';
import 'dart:io';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_router/shelf_router.dart';
import 'package:mcp_structure_validator/mcp_structure_validator.dart';

/// Clean HTTP REST API for flutter-structure-validator
///
/// Usage:
///   dart run flutter_tools/mcp_structure_validator/bin/http_server.dart
///
/// Endpoints:
///   POST /ask_placement       - Validate component placement before creating
///   POST /verify_implementation - Verify code after creating
///   GET  /health              - Health check
///
/// This is the recommended way to use the validator:
/// - Type-safe JSON API
/// - Works with Postman, curl, any HTTP client
/// - Clean error handling
/// - No stdin/stdout complexity

Future<void> main(List<String> args) async {
  final port = int.tryParse(Platform.environment['PORT'] ?? '') ?? 8080;

  stderr.writeln('🏗️  Initializing flutter-structure-validator...');

  await _ensureOllamaRunning();

  // Initialize validator once at startup
  final aiClient = LocalAIClient();
  final instructionReader = InstructionReader(
    basePath: '${Directory.current.path}/flutter_tools/instructions',
  );
  final validator = ConsultativeValidator(
    aiClient: aiClient,
    instructionReader: instructionReader,
    projectRoot: Directory.current.path,
  );

  stderr.writeln('📚 Loading architectural instructions...');
  await validator.initialize();
  stderr.writeln('✅ Instructions loaded into AI context\n');

  // Create HTTP router
  final app = Router();

  // Health check endpoint
  app.get('/health', (Request request) {
    return Response.ok(
      jsonEncode({'status': 'ok', 'service': 'flutter-structure-validator'}),
      headers: {'Content-Type': 'application/json'},
    );
  });

  // Ask placement endpoint
  app.post('/ask_placement', (Request request) async {
    try {
      final body = await request.readAsString();
      final json = jsonDecode(body) as Map<String, dynamic>;

      // Validate required fields
      final intent = json['intent'] as String?;
      final purpose = json['purpose'] as String?;
      final proposedPaths = json['proposedPaths'] as List?;
      final componentType = json['componentType'] as String?;
      final featurePath = json['featurePath'] as String?;

      if (intent == null ||
          purpose == null ||
          proposedPaths == null ||
          componentType == null ||
          featurePath == null) {
        return Response.badRequest(
          body: jsonEncode({
            'error': 'Missing required fields',
            'required': [
              'intent',
              'purpose',
              'proposedPaths',
              'componentType',
              'featurePath'
            ],
          }),
          headers: {'Content-Type': 'application/json'},
        );
      }

      // Create query
      final query = PlacementQuery(
        intent: intent,
        purpose: purpose,
        proposedPaths: proposedPaths.cast<String>(),
        componentType: componentType,
        featurePath: featurePath,
        codeOutline: json['codeOutline'] as String?,
      );

      stderr.writeln(
          '🤔 Validating: $componentType at ${query.proposedPaths.first}');

      // Get validation response
      final response = await validator.askPlacementGuidance(query);

      stderr.writeln(
          response.isCorrect ? '✅ Correct placement' : '❌ Needs correction');

      // Return structured response
      return Response.ok(
        jsonEncode({
          'isCorrect': response.isCorrect,
          'explanation': response.explanation,
          'instructionFiles': response.instructionFiles.join(', '),
        }),
        headers: {'Content-Type': 'application/json'},
      );
    } catch (e, stack) {
      stderr.writeln('❌ Error in /ask_placement: $e');
      stderr.writeln(stack);
      return Response.internalServerError(
        body: jsonEncode({'error': e.toString()}),
        headers: {'Content-Type': 'application/json'},
      );
    }
  });

  // Verify implementation endpoint
  app.post('/verify_implementation', (Request request) async {
    try {
      final body = await request.readAsString();
      final json = jsonDecode(body) as Map<String, dynamic>;

      // Validate required fields
      final filePath = json['filePath'] as String?;
      final code = json['code'] as String?;
      final intent = json['intent'] as String?;
      final componentType = json['componentType'] as String?;
      final featurePath = json['featurePath'] as String?;

      if (filePath == null ||
          code == null ||
          intent == null ||
          componentType == null ||
          featurePath == null) {
        return Response.badRequest(
          body: jsonEncode({
            'error': 'Missing required fields',
            'required': [
              'filePath',
              'code',
              'intent',
              'componentType',
              'featurePath'
            ],
          }),
          headers: {'Content-Type': 'application/json'},
        );
      }

      stderr.writeln('🔍 Verifying: $filePath');

      // Build verification prompt
      final verificationPrompt = '''
You are a Flutter/Dart Clean Architecture code validator.
Your ONLY job is to validate Dart code against architectural patterns.

DO NOT generate any code. DO NOT write Python. DO NOT write examples.
ONLY validate the Dart code provided below.

**DART IMPLEMENTATION TO VALIDATE:**
File: $filePath
Type: $componentType
Feature: $featurePath
Intent: $intent

**DART CODE TO VALIDATE:**
```dart
$code
```

**ARCHITECTURAL RULES (Flutter/Dart Clean Architecture):**
${validator.instructionsContext}

**YOUR TASK:**
Validate ONLY. Do not generate code. Do not suggest Python alternatives.
Check if this Dart implementation follows Clean Architecture patterns.

**RESPOND IN EXACTLY THIS FORMAT (NO OTHER TEXT):**

IS_VALID: yes/no
ISSUES: (list any problems found, or write "None" if code is valid)
EXPLANATION: (brief explanation of validation result)
SUGGESTIONS: (improvements for the Dart code, if any)
REFERENCE: (which instruction file applies)

IMPORTANT: 
- Only validate the Dart code above
- Do not generate Python code
- Do not generate alternative implementations
- Do not add code examples
- Answer in plain text using the format above
''';

      final verificationResult =
          await validator.aiClient.generate(verificationPrompt);

      // Parse result
      final isValidMatch = RegExp(r'IS_VALID:\s*(yes|no)', caseSensitive: false)
          .firstMatch(verificationResult);
      final isValid = isValidMatch?.group(1)?.toLowerCase() == 'yes';

      stderr.writeln(isValid ? '✅ Valid implementation' : '⚠️  Issues found');

      // Return structured response
      return Response.ok(
        jsonEncode({
          'isValid': isValid,
          'filePath': filePath,
          'rawResponse': verificationResult,
        }),
        headers: {'Content-Type': 'application/json'},
      );
    } catch (e, stack) {
      stderr.writeln('❌ Error in /verify_implementation: $e');
      stderr.writeln(stack);
      return Response.internalServerError(
        body: jsonEncode({'error': e.toString()}),
        headers: {'Content-Type': 'application/json'},
      );
    }
  });

  // Start HTTP server
  final handler = const Pipeline().addMiddleware(logRequests()).addHandler(app);

  final server = await shelf_io.serve(handler, InternetAddress.anyIPv4, port);

  stderr.writeln('✅ HTTP server running on http://localhost:${server.port}');
  stderr.writeln('');
  stderr.writeln('📡 Endpoints:');
  stderr.writeln('   POST http://localhost:${server.port}/ask_placement');
  stderr
      .writeln('   POST http://localhost:${server.port}/verify_implementation');
  stderr.writeln('   GET  http://localhost:${server.port}/health');
  stderr.writeln('');
  stderr.writeln('🧪 Test with:');
  stderr.writeln('   curl http://localhost:${server.port}/health');
}

Future<void> _ensureOllamaRunning() async {
  try {
    stderr.write('Checking Ollama...');

    final ollamaUrl =
        Platform.environment['OLLAMA_HOST'] ?? 'http://localhost:11434';
    final testUrl =
        ollamaUrl.startsWith('http') ? ollamaUrl : 'http://$ollamaUrl';

    stderr.write(' ($testUrl)...');

    final result = await Process.run('curl', [
      '-s',
      '--connect-timeout',
      '3',
      '--max-time',
      '5',
      '$testUrl/api/tags'
    ]);

    if (result.exitCode == 0) {
      stderr.writeln(' ✓');

      final aiClient = LocalAIClient();
      final hasModel = await aiClient.checkAvailability();
      if (!hasModel) {
        stderr.writeln('⚠️  Warning: ${aiClient.model} not found in Ollama');
        stderr.writeln('   Run: ollama pull ${aiClient.model}');
      }
    } else {
      stderr.writeln(' ✗');
      stderr.writeln('❌ Ollama is not accessible at $testUrl');
      stderr.writeln('   Please ensure Ollama is running:');
      stderr.writeln('   - Check: ollama ps');
      stderr.writeln('   - Or run: ollama serve');
      exit(1);
    }
  } catch (e) {
    stderr.writeln('Warning: $e');
  }
}
