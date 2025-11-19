import 'dart:convert' show jsonDecode;
import 'dart:io' show stderr;

import 'placement_query.dart';
import 'validator_response.dart';
import '../ai/local_ai_client.dart';
import '../readers/instruction_reader.dart';
import '../analyzers/codebase_context_analyzer.dart';
import '../validation/path_validation_rules.dart';

/// Consultative validator that answers generator AI's placement questions
///
/// Flow:
/// 1. At startup: Reads ALL instruction files into context
/// 2. When asked: Analyzes existing feature structure for context
/// 3. Asks clarifying questions if needed
/// 4. Generator AI provides answers
/// 5. Validator AI uses full context to respond with guidance
/// 6. Generator AI implements code in the correct location
///
/// The validator AI has:
/// - Full context of all architectural patterns (from instructions)
/// - Full context of existing codebase structure (from analysis)
/// - Ability to ask clarifying questions (proactive validation)
class ConsultativeValidator {
  final LocalAIClient aiClient;
  final InstructionReader instructionReader;
  final String projectRoot;
  late final CodebaseContextAnalyzer codebaseAnalyzer;

  /// Cached context of all instruction files
  /// Loaded once at startup for efficiency
  /// Made public so MCP server can access it for verification
  String? instructionsContext;

  ConsultativeValidator({
    required this.aiClient,
    required this.instructionReader,
    required this.projectRoot,
  }) {
    codebaseAnalyzer = CodebaseContextAnalyzer(projectRoot: projectRoot);
  }

  /// Initialize by reading all instruction files
  /// This gives the validator AI the full architectural context
  Future<void> initialize() async {
    if (instructionsContext != null) return; // Already initialized

    final buffer = StringBuffer();
    buffer.writeln('# Flutter Clean Architecture Instructions\n');
    buffer.writeln('The following are ALL architectural patterns and rules:\n');

    // Read all instruction files
    final instructionFiles = [
      'structure.instructions.md',
      'usecase.instructions.md',
      'cubit.instructions.md',
      'offline_repository_pattern.instructions.md',
      'create_ui.instructions.md',
      'navigation.instructions.md',
      'api.instructions.md',
      'injecting.instructions.md',
    ];

    for (final file in instructionFiles) {
      try {
        final content = await instructionReader.read(file);
        buffer.writeln('## From: $file\n');
        buffer.writeln(content);
        buffer.writeln('\n---\n');
      } catch (e) {
        // File might not exist, skip it
        stderr.writeln('⚠️  Could not read $file: $e');
        continue;
      }
    }

    instructionsContext = buffer.toString();
  }

  /// Read a specific instruction file on-demand
  /// This is more efficient than loading all files upfront
  Future<String> readInstructionFile(String filename) async {
    try {
      return await instructionReader.read(filename);
    } catch (e) {
      stderr.writeln('⚠️  Failed to read instruction file: $filename');
      return 'Instruction file not found: $filename';
    }
  }

  /// Generator AI asks validator AI where to place code
  ///
  /// The validator will:
  /// 1. Use rule-based validation to check path pattern (deterministic)
  /// 2. Return simple response: isCorrect + explanation
  /// 3. NO AI validation here - just path pattern checking
  ///
  /// AI validation only happens in verify_implementation after code is written
  Future<ValidatorResponse> askPlacementGuidance(
    PlacementQuery query,
  ) async {
    // Step 1: Use rule-based validation (deterministic)
    stderr.writeln('🔍 Validating path pattern with rules engine...');
    final validationResult = PathValidationRules.validate(
      componentType: query.componentType,
      proposedPath: query.proposedPaths.first,
      featurePath: query.featurePath,
    );

    stderr.writeln('📊 Validation Result:');
    stderr.writeln('   isCorrect: ${validationResult.isCorrect}');
    stderr.writeln('   Layer: ${validationResult.architecturalLayer}');
    stderr.writeln('   Explanation: ${validationResult.explanation}');

    // Return result directly - no AI needed for path validation
    return ValidatorResponse(
      isCorrect: validationResult.isCorrect,
      explanation: validationResult.explanation,
      instructionFiles: validationResult.relevantInstructions,
    );
  }

  /// Verify implementation after code is written
  /// This is where AI actually checks if code follows architectural patterns
  Future<ValidatorResponse> verifyImplementation(
    PlacementQuery query,
  ) async {
    // Step 1: Validate path first
    stderr.writeln('🔍 Validating path pattern...');
    final validationResult = PathValidationRules.validate(
      componentType: query.componentType,
      proposedPath: query.proposedPaths.first,
      featurePath: query.featurePath,
    );

    if (!validationResult.isCorrect) {
      // Path is wrong - return early
      return ValidatorResponse(
        isCorrect: false,
        explanation: '❌ Path is incorrect: ${validationResult.explanation}',
        instructionFiles: validationResult.relevantInstructions,
      );
    }

    // Step 2: Analyze existing feature structure
    stderr.writeln('🔍 Analyzing feature structure: ${query.featurePath}');
    final featureContext =
        await codebaseAnalyzer.analyzeFeature(query.featurePath);
    final contextSummary = featureContext.toContextSummary();

    stderr.writeln('📊 Found ${featureContext.components.length} components');

    // Step 3: Build prompt for AI to check code patterns
    final prompt = await _buildValidationPrompt(
      query,
      validationResult,
      contextSummary,
    );

    stderr.writeln('📝 Prompt : ${prompt.length} chars');

    // Step 4: Get AI's validation of actual code
    final aiResponse = await aiClient.generate(prompt);

    stderr.writeln('🤖 Full AI Response:');
    stderr.writeln('─' * 60);
    stderr.writeln(aiResponse);
    stderr.writeln('─' * 60);

    // Parse response
    return _parseValidationResponse(aiResponse, validationResult);
  }

  /// Build validation prompt for AI
  Future<String> _buildValidationPrompt(
    PlacementQuery query,
    ValidationResult validationResult,
    String codebaseContext,
  ) async {
    final buffer = StringBuffer();

    buffer.writeln('You are a Flutter Clean Architecture expert.');
    buffer.writeln();
    buffer.writeln('CONTEXT:');
    buffer.writeln('A generator AI wants to create: ${query.componentType}');
    buffer.writeln('Intent: ${query.intent}');
    buffer.writeln('Purpose: ${query.purpose}');
    buffer.writeln('Proposed Path: ${query.proposedPaths.first}');
    buffer.writeln();

    // Show validation result
    buffer.writeln('PATH VALIDATION RESULT:');
    buffer.writeln(
        '✓ Path Pattern: ${validationResult.isCorrect ? "CORRECT" : "INCORRECT"}');
    if (!validationResult.isCorrect) {
      buffer
          .writeln('  Correct Path Should Be: ${validationResult.correctPath}');
    }
    buffer.writeln('  Layer: ${validationResult.architecturalLayer}');
    buffer.writeln('  Explanation: ${validationResult.explanation}');
    buffer.writeln();

    // Show existing codebase context
    buffer.writeln('EXISTING FEATURE STRUCTURE:');
    buffer.writeln(codebaseContext);
    buffer.writeln();

    // Load instruction files conditionally based on validation result
    if (!validationResult.isCorrect) {
      // Path is WRONG - provide full instructions so AI understands how to fix it
      buffer.writeln('=' * 80);
      buffer.writeln(
          'ARCHITECTURAL RULES (Read carefully to understand the error)');
      buffer.writeln('=' * 80);
      buffer.writeln();
      buffer.writeln(
          'The proposed path is INCORRECT. Read these instructions to understand');
      buffer
          .writeln('the correct placement pattern for ${query.componentType}:');
      buffer.writeln();

      for (final instructionFile in validationResult.relevantInstructions) {
        final content = await readInstructionFile(instructionFile);
        buffer.writeln('## From: $instructionFile');
        buffer.writeln(content);
        buffer.writeln();
      }
    } else {
      // Path is CORRECT - just reference the instructions, don't load full content
      buffer.writeln('=' * 80);
      buffer.writeln('RELEVANT INSTRUCTION FILES (for your reference)');
      buffer.writeln('=' * 80);
      buffer.writeln();
      buffer.writeln(
          'The path is CORRECT. For implementation patterns, you can refer to:');
      for (final instructionFile in validationResult.relevantInstructions) {
        buffer.writeln('- $instructionFile');
      }
      buffer.writeln();
      buffer.writeln(
          'Focus on providing specific, actionable requirements for this ${query.componentType}.');
      buffer.writeln(
          'DO NOT copy examples from instructions - provide NEW requirements specific to:');
      buffer.writeln(
          '  Component: ${query.proposedPaths.first.split('/').last.replaceAll('.dart', '')}');
      buffer.writeln('  Feature: ${query.featurePath}');
      buffer.writeln();
    }
    buffer.writeln();

    // Task: Generate requirements only
    buffer.writeln('=' * 80);
    buffer.writeln('YOUR TASK');
    buffer.writeln('=' * 80);
    buffer.writeln();
    buffer.writeln('**CRITICAL INSTRUCTIONS:**');
    buffer.writeln(
        '1. You are providing requirements for: ${query.componentType}');
    buffer.writeln(
        '2. The component name is: ${query.proposedPaths.first.split('/').last.replaceAll('.dart', '')}');

    if (!validationResult.isCorrect) {
      buffer.writeln(
          '3. ⚠️ THE PATH IS INCORRECT - Explain why and provide the correct path');
      buffer.writeln(
          '4. Read the architectural rules above to understand the correct pattern');
      buffer.writeln(
          '5. Provide clear, detailed guidance on how to fix the placement error');
    } else {
      buffer.writeln(
          '3. ✓ THE PATH IS CORRECT - Now check if code follows architectural patterns');
      buffer.writeln('4. Read the instruction files listed above');
      buffer.writeln(
          '5. Check if the code violates any patterns from those instructions');
      buffer.writeln(
          '6. If violations found: set isCorrect=false and explain what\'s wrong');
      buffer.writeln(
          '7. If no violations: set isCorrect=true with brief confirmation');
    }
    buffer.writeln();

    // Simple JSON format
    buffer.writeln('=' * 80);
    buffer.writeln('RESPONSE FORMAT');
    buffer.writeln('=' * 80);
    buffer.writeln();
    buffer.writeln('Respond with JSON ONLY (no markdown, no extra text):');
    buffer.writeln();
    buffer.writeln('{');
    buffer.writeln('  "isCorrect": true,  // false if code violates patterns');
    buffer.writeln(
        '  "explanation": "Brief explanation of what\'s correct or wrong",');
    buffer.writeln(
        '  "instructionFiles": ["file1.md", "file2.md"]  // Files you used');
    buffer.writeln('}');
    buffer.writeln();
    buffer.writeln('**RULES:**');
    buffer.writeln('- Output ONLY valid JSON (no code blocks, no extra text)');
    buffer.writeln(
        '- isCorrect: true if code follows all patterns, false if violations exist');
    buffer.writeln(
        '- explanation: Clear, specific reason (what\'s wrong or confirmation it\'s correct)');
    buffer.writeln(
        '- instructionFiles: List of instruction files you referenced');

    return buffer.toString();
  }

  /// Parse AI validation response - expecting simple JSON with isCorrect/explanation/instructionFiles
  ValidatorResponse _parseValidationResponse(
    String aiResponse,
    ValidationResult validationResult,
  ) {
    try {
      // Try to find JSON in the response
      final jsonMatch = RegExp(
        r'\{[\s\S]*"isCorrect"[\s\S]*\}',
        multiLine: true,
      ).firstMatch(aiResponse);

      if (jsonMatch != null) {
        final jsonStr = jsonMatch.group(0)!;
        final json = jsonDecode(jsonStr) as Map<String, dynamic>;

        return ValidatorResponse(
          isCorrect: json['isCorrect'] as bool,
          explanation: json['explanation'] as String,
          instructionFiles: (json['instructionFiles'] as List?)
                  ?.map((e) => e.toString())
                  .toList() ??
              validationResult.relevantInstructions,
        );
      }
    } catch (e) {
      stderr.writeln('❌ Failed to parse AI response as JSON: $e');
    }

    // Fallback: Use validation result directly
    return ValidatorResponse(
      isCorrect: validationResult.isCorrect,
      explanation: validationResult.explanation,
      instructionFiles: validationResult.relevantInstructions,
    );
  }
}
