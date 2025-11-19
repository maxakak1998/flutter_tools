import 'dart:convert';
import 'dart:io';
import 'package:mcp_structure_validator/mcp_structure_validator.dart';

void main() async {
  stderr.writeln('Consultative Flutter Validator starting...');
  stderr.writeln('Generator asks, Validator answers!\n');

  await _ensureOllamaRunning();

  final aiClient = LocalAIClient();
  final instructionReader = InstructionReader(
    basePath: '${Directory.current.path}/flutter_tools/instructions',
  );
  final validator = ConsultativeValidator(
    aiClient: aiClient,
    instructionReader: instructionReader,
    projectRoot: Directory.current.path,
  );

  stderr.writeln('📚 Loading all instruction files...');
  await validator.initialize();
  stderr.writeln('✓ All instructions loaded into context');
  stderr.writeln('✓ Ready for placement queries\n');

  await for (final line
      in stdin.transform(utf8.decoder).transform(LineSplitter())) {
    if (line.trim().isEmpty) continue;
    try {
      final request = jsonDecode(line) as Map<String, dynamic>;
      final response = await _handleRequest(request, validator);
      stdout.writeln(jsonEncode(response));
    } catch (e) {
      stderr.writeln('Error: $e');
    }
  }
}

Future<Map<String, dynamic>> _handleRequest(
    Map<String, dynamic> request, ConsultativeValidator validator) async {
  final method = request['method'] as String?;
  final id = request['id'];
  stderr.writeln('📨 Method: $method, ID: $id');

  if (method == 'initialize') {
    return {
      'jsonrpc': '2.0',
      'id': id,
      'result': {
        'protocolVersion': '0.1.0',
        'capabilities': {'tools': {}},
        'serverInfo': {
          'name': 'flutter-structure-validator',
          'version': '2.0.0'
        },
      },
    };
  }

  if (method == 'tools/list') {
    return {
      'jsonrpc': '2.0',
      'id': id,
      'result': {
        'tools': [
          {
            'name': 'ask_placement',
            'description':
                'Ask validator AI where to place code BEFORE implementing',
            'inputSchema': {
              'type': 'object',
              'properties': {
                'intent': {
                  'type': 'string',
                  'description': 'What to implement'
                },
                'purpose': {
                  'type': 'string',
                  'description': 'Purpose of the code'
                },
                'proposedPaths': {
                  'type': 'array',
                  'items': {'type': 'string'}
                },
                'componentType': {
                  'type': 'string',
                  'description': 'UseCase/Cubit/Repository/etc'
                },
                'featurePath': {'type': 'string'},
                'codeOutline': {
                  'type': 'string',
                  'description': 'Optional code sketch'
                },
              },
              'required': [
                'intent',
                'purpose',
                'proposedPaths',
                'componentType',
                'featurePath'
              ],
            },
          },
          {
            'name': 'verify_implementation',
            'description':
                'Ask validator AI to verify code AFTER implementing (MANDATORY)',
            'inputSchema': {
              'type': 'object',
              'properties': {
                'filePath': {
                  'type': 'string',
                  'description': 'Path to file that was implemented'
                },
                'code': {
                  'type': 'string',
                  'description': 'The actual code that was written'
                },
                'intent': {
                  'type': 'string',
                  'description': 'What you intended to implement'
                },
                'componentType': {
                  'type': 'string',
                  'description': 'UseCase/Cubit/Repository/etc'
                },
                'featurePath': {'type': 'string'},
              },
              'required': [
                'filePath',
                'code',
                'intent',
                'componentType',
                'featurePath'
              ],
            },
          },
        ],
      },
    };
  }

  if (method == 'tools/call') {
    final params = request['params'] as Map<String, dynamic>;
    final toolName = params['name'] as String;
    final args = params['arguments'] as Map<String, dynamic>;

    if (toolName == 'ask_placement') {
      final query = PlacementQuery(
        intent: args['intent'] as String,
        purpose: args['purpose'] as String,
        proposedPaths: (args['proposedPaths'] as List).cast<String>(),
        componentType: args['componentType'] as String,
        featurePath: args['featurePath'] as String,
        codeOutline: args['codeOutline'] as String?,
      );

      stderr.writeln('🤔 Q: "${query.intent}"');
      final response = await validator.askPlacementGuidance(query);
      stderr.writeln(response.isCorrect ? '✅ Correct' : '❌ Wrong placement');

      return {
        'jsonrpc': '2.0',
        'id': id,
        'result': {
          'content': [
            {'type': 'text', 'text': response.toMarkdown()}
          ],
          '_meta': response.toJson(),
        },
      };
    }

    if (toolName == 'verify_implementation') {
      final filePath = args['filePath'] as String;
      final code = args['code'] as String;
      final intent = args['intent'] as String;
      final componentType = args['componentType'] as String;
      final featurePath = args['featurePath'] as String;

      stderr.writeln('🔍 Verifying: $filePath');

      // Ensure validator has full context
      await validator.initialize();

      // Build verification prompt with full instructions context
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

      stderr.writeln(isValid ? '✅ Valid' : '❌ Issues found');

      return {
        'jsonrpc': '2.0',
        'id': id,
        'result': {
          'content': [
            {'type': 'text', 'text': verificationResult}
          ],
          '_meta': {
            'isValid': isValid,
            'filePath': filePath,
            'rawResponse': verificationResult,
          },
        },
      };
    }
  }

  return {
    'jsonrpc': '2.0',
    'id': id,
    'error': {'code': -32601, 'message': 'Method not found'}
  };
}

Future<void> _ensureOllamaRunning() async {
  try {
    stderr.write('Checking Ollama...');

    // Detect Ollama URL (same logic as LocalAIClient)
    final ollamaUrl =
        Platform.environment['OLLAMA_HOST'] ?? 'http://localhost:11434';
    final testUrl =
        ollamaUrl.startsWith('http') ? ollamaUrl : 'http://$ollamaUrl';

    stderr.write(' ($testUrl)...');

    // Test if Ollama is accessible
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

      // Check if required model is available
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

/// Get relevant instructions for a component type
