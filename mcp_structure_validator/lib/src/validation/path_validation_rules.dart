/// Validation rules for component path patterns
///
/// This provides a rule-based validation system instead of relying on AI
/// to parse all instruction files. The AI still provides explanations,
/// but the core validation logic is deterministic.

class PathValidationRules {
  /// Validate component path against expected pattern
  static ValidationResult validate({
    required String componentType,
    required String proposedPath,
    required String featurePath,
  }) {
    final featureName = _extractFeatureName(featurePath);

    switch (componentType.toLowerCase()) {
      case 'usecase':
        return _validateUseCase(proposedPath, featureName);
      case 'cubit':
        return _validateCubit(proposedPath, featureName);
      case 'repository':
        return _validateRepository(proposedPath, featureName);
      case 'screen':
        return _validateScreen(proposedPath, featureName);
      case 'widget':
        return _validateWidget(proposedPath, featureName);
      case 'coordinator':
        return _validateCoordinator(proposedPath, featureName);
      case 'orchestrator':
        return _validateOrchestrator(proposedPath, featureName);
      case 'model':
        return _validateModel(proposedPath, featureName);
      case 'route':
        return _validateRoute(proposedPath, featureName);
      default:
        return ValidationResult(
          isCorrect: false,
          correctPath: null,
          explanation: 'Unknown component type: $componentType',
          architecturalLayer: 'Unknown',
          relevantInstructions: [],
        );
    }
  }

  static String _extractFeatureName(String featurePath) {
    // Extract feature name from path like "lib/features/auth"
    final parts = featurePath.split('/');
    return parts.last;
  }

  static ValidationResult _validateUseCase(String path, String feature) {
    final expectedPattern = RegExp(
        r'^lib/features/' + feature + r'/domain/useCases/\w+_use_case\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'UseCase correctly placed in domain/useCases/ layer',
        architecturalLayer: 'Domain (Business Logic)',
        relevantInstructions: [
          'structure.instructions.md',
          'usecase.instructions.md'
        ],
      );
    }

    // Extract filename
    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/domain/useCases/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'UseCases must be in domain/useCases/ layer (business logic layer)',
      architecturalLayer: 'Domain (Business Logic)',
      relevantInstructions: [
        'structure.instructions.md',
        'usecase.instructions.md'
      ],
    );
  }

  static ValidationResult _validateCubit(String path, String feature) {
    final expectedPattern = RegExp(
        r'^lib/features/' + feature + r'/presentation/cubit/\w+_cubit\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'Cubit correctly placed in presentation/cubit/ layer',
        architecturalLayer: 'Presentation (State Management)',
        relevantInstructions: [
          'structure.instructions.md',
          'cubit.instructions.md'
        ],
      );
    }

    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/presentation/cubit/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Cubits must be in presentation/cubit/ layer (state management)',
      architecturalLayer: 'Presentation (State Management)',
      relevantInstructions: [
        'structure.instructions.md',
        'cubit.instructions.md'
      ],
    );
  }

  static ValidationResult _validateRepository(String path, String feature) {
    // Check if it's an interface (domain) or implementation (data)
    final isInterface = path.contains('/domain/repositories/');
    final isImplementation = path.contains('/data/repositories/');

    if (isInterface) {
      final expectedPattern = RegExp(r'^lib/features/' +
          feature +
          r'/domain/repositories/i_\w+_repository\.dart$');

      if (expectedPattern.hasMatch(path)) {
        return ValidationResult(
          isCorrect: true,
          correctPath: null,
          explanation:
              'Repository interface correctly placed in domain/repositories/ with i_ prefix',
          architecturalLayer: 'Domain (Interface/Contract)',
          relevantInstructions: [
            'structure.instructions.md',
            'offline_repository_pattern.instructions.md'
          ],
        );
      }

      final filename = path.split('/').last;
      final hasPrefix = filename.startsWith('i_');
      final correctFilename = hasPrefix ? filename : 'i_$filename';
      final correctPath =
          'lib/features/$feature/domain/repositories/$correctFilename';

      return ValidationResult(
        isCorrect: false,
        correctPath: correctPath,
        explanation:
            'Repository interfaces must be in domain/repositories/ with i_ prefix',
        architecturalLayer: 'Domain (Interface/Contract)',
        relevantInstructions: [
          'structure.instructions.md',
          'offline_repository_pattern.instructions.md'
        ],
      );
    }

    if (isImplementation) {
      final expectedPattern = RegExp(r'^lib/features/' +
          feature +
          r'/data/repositories/\w+_repository\.dart$');

      if (expectedPattern.hasMatch(path) && !path.contains('/i_')) {
        return ValidationResult(
          isCorrect: true,
          correctPath: null,
          explanation:
              'Repository implementation correctly placed in data/repositories/',
          architecturalLayer: 'Data (Implementation)',
          relevantInstructions: [
            'structure.instructions.md',
            'offline_repository_pattern.instructions.md'
          ],
        );
      }

      final filename = path.split('/').last.replaceFirst('i_', '');
      final correctPath = 'lib/features/$feature/data/repositories/$filename';

      return ValidationResult(
        isCorrect: false,
        correctPath: correctPath,
        explanation:
            'Repository implementations must be in data/repositories/ without i_ prefix',
        architecturalLayer: 'Data (Implementation)',
        relevantInstructions: [
          'structure.instructions.md',
          'offline_repository_pattern.instructions.md'
        ],
      );
    }

    // If neither interface nor implementation path detected
    return ValidationResult(
      isCorrect: false,
      correctPath:
          'lib/features/$feature/domain/repositories/i_${feature}_repository.dart',
      explanation:
          'Repository must be in either domain/repositories/ (interface) or data/repositories/ (implementation)',
      architecturalLayer: 'Domain or Data',
      relevantInstructions: [
        'structure.instructions.md',
        'offline_repository_pattern.instructions.md'
      ],
    );
  }

  static ValidationResult _validateScreen(String path, String feature) {
    final expectedPattern = RegExp(r'^lib/features/' +
        feature +
        r'/presentation/screen/\w+_screen\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'Screen correctly placed in presentation/screen/ layer',
        architecturalLayer: 'Presentation (UI)',
        relevantInstructions: [
          'structure.instructions.md',
          'create_ui.instructions.md',
          'cubit.instructions.md',
        ],
      );
    }

    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/presentation/screen/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Screens must be in presentation/screen/ layer (UI rendering)',
      architecturalLayer: 'Presentation (UI)',
      relevantInstructions: [
        'structure.instructions.md',
        'create_ui.instructions.md',
        'cubit.instructions.md',
      ],
    );
  }

  static ValidationResult _validateWidget(String path, String feature) {
    final expectedPattern = RegExp(r'^lib/features/' +
        feature +
        r'/presentation/widgets/\w+(_widget)?\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'Widget correctly placed in presentation/widgets/ layer',
        architecturalLayer: 'Presentation (Reusable UI)',
        relevantInstructions: [
          'structure.instructions.md',
          'create_ui.instructions.md'
        ],
      );
    }

    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/presentation/widgets/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Widgets must be in presentation/widgets/ layer (reusable UI components)',
      architecturalLayer: 'Presentation (Reusable UI)',
      relevantInstructions: [
        'structure.instructions.md',
        'create_ui.instructions.md'
      ],
    );
  }

  static ValidationResult _validateCoordinator(String path, String feature) {
    final expectedPattern = RegExp(r'^lib/features/' +
        feature +
        r'/presentation/coordinators/\w+_coordinator\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation:
            'Coordinator correctly placed in presentation/coordinators/ layer',
        architecturalLayer: 'Presentation (UI Flow)',
        relevantInstructions: ['structure.instructions.md'],
      );
    }

    final filename = path.split('/').last;
    final correctPath =
        'lib/features/$feature/presentation/coordinators/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Coordinators must be in presentation/coordinators/ layer (UI navigation flows)',
      architecturalLayer: 'Presentation (UI Flow)',
      relevantInstructions: ['structure.instructions.md'],
    );
  }

  static ValidationResult _validateOrchestrator(String path, String feature) {
    final expectedPattern = RegExp(r'^lib/features/' +
        feature +
        r'/application/orchestrators/\w+_orchestrator\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation:
            'Orchestrator correctly placed in application/orchestrators/ layer',
        architecturalLayer: 'Application (Cross-Feature Coordination)',
        relevantInstructions: ['structure.instructions.md'],
      );
    }

    final filename = path.split('/').last;
    final correctPath =
        'lib/features/$feature/application/orchestrators/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Orchestrators must be in application/orchestrators/ layer (cross-feature business logic)',
      architecturalLayer: 'Application (Cross-Feature Coordination)',
      relevantInstructions: ['structure.instructions.md'],
    );
  }

  static ValidationResult _validateModel(String path, String feature) {
    final expectedPattern = RegExp(
        r'^lib/features/' + feature + r'/domain/models/\w+(_model)?\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'Model correctly placed in domain/models/ layer',
        architecturalLayer: 'Domain (Business Entities)',
        relevantInstructions: ['structure.instructions.md'],
      );
    }

    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/domain/models/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation: 'Models must be in domain/models/ layer (business entities)',
      architecturalLayer: 'Domain (Business Entities)',
      relevantInstructions: ['structure.instructions.md'],
    );
  }

  static ValidationResult _validateRoute(String path, String feature) {
    final expectedPattern = RegExp(
        r'^lib/features/' + feature + r'/presentation/routes/\w+_route\.dart$');

    if (expectedPattern.hasMatch(path)) {
      return ValidationResult(
        isCorrect: true,
        correctPath: null,
        explanation: 'Route correctly placed in presentation/routes/ layer',
        architecturalLayer: 'Presentation (Navigation)',
        relevantInstructions: [
          'structure.instructions.md',
          'navigation.instructions.md'
        ],
      );
    }

    final filename = path.split('/').last;
    final correctPath = 'lib/features/$feature/presentation/routes/$filename';

    return ValidationResult(
      isCorrect: false,
      correctPath: correctPath,
      explanation:
          'Routes must be in presentation/routes/ layer (navigation definitions)',
      architecturalLayer: 'Presentation (Navigation)',
      relevantInstructions: [
        'structure.instructions.md',
        'navigation.instructions.md'
      ],
    );
  }
}

/// Result of path validation
class ValidationResult {
  final bool isCorrect;
  final String? correctPath;
  final String explanation;
  final String architecturalLayer;
  final List<String> relevantInstructions;

  ValidationResult({
    required this.isCorrect,
    required this.correctPath,
    required this.explanation,
    required this.architecturalLayer,
    required this.relevantInstructions,
  });
}
