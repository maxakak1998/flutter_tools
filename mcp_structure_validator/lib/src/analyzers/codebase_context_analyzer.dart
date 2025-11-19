import 'dart:io';

/// Analyzes the codebase structure to understand how components are connected
///
/// This gives the validator AI contextual awareness:
/// - What repositories exist in the feature
/// - What use cases are already implemented
/// - What cubits/screens are present
/// - How components reference each other
class CodebaseContextAnalyzer {
  final String projectRoot;

  CodebaseContextAnalyzer({required this.projectRoot});

  /// Analyze a feature's structure and component relationships
  ///
  /// Returns contextual information about:
  /// - Existing files and their purposes
  /// - Import relationships
  /// - Component dependencies
  Future<FeatureContext> analyzeFeature(String featurePath) async {
    final featureDir = Directory('$projectRoot/$featurePath');

    if (!await featureDir.exists()) {
      return FeatureContext.empty(featurePath);
    }

    final context = FeatureContext(featurePath: featurePath);

    // Scan domain layer
    await _scanLayer(
      featureDir,
      'domain',
      context,
      ['useCases', 'repositories', 'entities'],
    );

    // Scan data layer
    await _scanLayer(
      featureDir,
      'data',
      context,
      ['repositories', 'datasources', 'models'],
    );

    // Scan presentation layer
    await _scanLayer(
      featureDir,
      'presentation',
      context,
      ['cubit', 'screens', 'widgets'],
    );

    // Analyze relationships between components
    await _analyzeRelationships(context);

    return context;
  }

  /// Scan a specific layer (domain/data/presentation) for components
  Future<void> _scanLayer(
    Directory featureDir,
    String layerName,
    FeatureContext context,
    List<String> subdirs,
  ) async {
    for (final subdir in subdirs) {
      final path = '${featureDir.path}/$layerName/$subdir';
      final dir = Directory(path);

      if (!await dir.exists()) continue;

      await for (final entity in dir.list(recursive: true)) {
        if (entity is File && entity.path.endsWith('.dart')) {
          final component = await _analyzeFile(entity, layerName, subdir);
          context.addComponent(component);
        }
      }
    }
  }

  /// Analyze a single Dart file to extract component information
  Future<ComponentInfo> _analyzeFile(
    File file,
    String layer,
    String componentType,
  ) async {
    final content = await file.readAsString();
    final relativePath =
        file.path.replaceFirst('$projectRoot/', '').replaceAll('\\', '/');

    return ComponentInfo(
      filePath: relativePath,
      layer: layer,
      type: componentType,
      className: _extractClassName(content),
      imports: _extractImports(content),
      dependencies: _extractDependencies(content),
      methods: _extractPublicMethods(content),
    );
  }

  /// Extract the main class name from file content
  String? _extractClassName(String content) {
    final classMatch = RegExp(r'class\s+(\w+)(?:\s+extends|\s+implements|\s*{)')
        .firstMatch(content);
    return classMatch?.group(1);
  }

  /// Extract import statements
  List<String> _extractImports(String content) {
    final importRegex = RegExp(r'''import\s+['"](.+?)['"];''');
    return importRegex
        .allMatches(content)
        .map((m) => m.group(1)!)
        .where((import) => import.contains('lib/features'))
        .toList();
  }

  /// Extract constructor dependencies (injected classes)
  List<String> _extractDependencies(String content) {
    final constructorRegex =
        RegExp(r'(?:const\s+)?(\w+)\s*\([^)]*\)', multiLine: true);
    final parameterRegex = RegExp(r'(?:this\.)?_?(\w+Repository|\w+UseCase)');

    final dependencies = <String>[];

    for (final match in constructorRegex.allMatches(content)) {
      final constructorBody = match.group(0) ?? '';
      for (final paramMatch in parameterRegex.allMatches(constructorBody)) {
        dependencies.add(paramMatch.group(1)!);
      }
    }

    return dependencies.toSet().toList();
  }

  /// Extract public method names
  List<String> _extractPublicMethods(String content) {
    final methodRegex = RegExp(
      r'^\s+(?:Future<.+?>|void|\w+)\s+(\w+)\s*\(',
      multiLine: true,
    );

    return methodRegex
        .allMatches(content)
        .map((m) => m.group(1)!)
        .where((name) => !name.startsWith('_')) // Exclude private methods
        .toList();
  }

  /// Analyze relationships between components
  Future<void> _analyzeRelationships(FeatureContext context) async {
    for (final component in context.components) {
      // Find what this component depends on
      for (final dep in component.dependencies) {
        final dependency = context.components.firstWhere(
          (c) => c.className == dep,
          orElse: () => ComponentInfo.unknown(dep),
        );

        context.addRelationship(
          from: component.className ?? 'Unknown',
          to: dependency.className ?? dep,
          type: _determineRelationType(component.type, dependency.type),
        );
      }
    }
  }

  /// Determine the type of relationship based on component types
  String _determineRelationType(String fromType, String toType) {
    if (fromType == 'cubit' && toType == 'useCases') return 'uses-usecase';
    if (fromType == 'useCases' && toType == 'repositories') {
      return 'uses-repository';
    }
    if (fromType == 'repositories' && toType == 'datasources') {
      return 'uses-datasource';
    }
    return 'depends-on';
  }
}

/// Represents the complete context of a feature
class FeatureContext {
  final String featurePath;
  final List<ComponentInfo> components = [];
  final List<ComponentRelationship> relationships = [];

  FeatureContext({required this.featurePath});

  factory FeatureContext.empty(String featurePath) =>
      FeatureContext(featurePath: featurePath);

  void addComponent(ComponentInfo component) {
    components.add(component);
  }

  void addRelationship({
    required String from,
    required String to,
    required String type,
  }) {
    relationships.add(ComponentRelationship(from: from, to: to, type: type));
  }

  /// Get all components of a specific type
  List<ComponentInfo> getComponentsByType(String type) {
    return components.where((c) => c.type == type).toList();
  }

  /// Get all components in a specific layer
  List<ComponentInfo> getComponentsByLayer(String layer) {
    return components.where((c) => c.layer == layer).toList();
  }

  /// Find a component by class name
  ComponentInfo? findComponent(String className) {
    try {
      return components.firstWhere((c) => c.className == className);
    } catch (e) {
      return null;
    }
  }

  /// Format as a structured summary for AI consumption
  String toContextSummary() {
    final buffer = StringBuffer();

    buffer.writeln('## Feature: $featurePath\n');

    // Domain layer summary
    buffer.writeln('### Domain Layer');
    final domainComponents = getComponentsByLayer('domain');
    if (domainComponents.isEmpty) {
      buffer.writeln('- No components yet\n');
    } else {
      for (final comp in domainComponents) {
        buffer.writeln('- ${comp.className} (${comp.type})');
        if (comp.dependencies.isNotEmpty) {
          buffer.writeln('  Dependencies: ${comp.dependencies.join(", ")}');
        }
      }
      buffer.writeln();
    }

    // Data layer summary
    buffer.writeln('### Data Layer');
    final dataComponents = getComponentsByLayer('data');
    if (dataComponents.isEmpty) {
      buffer.writeln('- No components yet\n');
    } else {
      for (final comp in dataComponents) {
        buffer.writeln('- ${comp.className} (${comp.type})');
        if (comp.dependencies.isNotEmpty) {
          buffer.writeln('  Dependencies: ${comp.dependencies.join(", ")}');
        }
      }
      buffer.writeln();
    }

    // Presentation layer summary
    buffer.writeln('### Presentation Layer');
    final presentationComponents = getComponentsByLayer('presentation');
    if (presentationComponents.isEmpty) {
      buffer.writeln('- No components yet\n');
    } else {
      for (final comp in presentationComponents) {
        buffer.writeln('- ${comp.className} (${comp.type})');
        if (comp.dependencies.isNotEmpty) {
          buffer.writeln('  Dependencies: ${comp.dependencies.join(", ")}');
        }
      }
      buffer.writeln();
    }

    // Relationships
    if (relationships.isNotEmpty) {
      buffer.writeln('### Component Relationships');
      for (final rel in relationships) {
        buffer.writeln('- ${rel.from} --[${rel.type}]--> ${rel.to}');
      }
      buffer.writeln();
    }

    return buffer.toString();
  }
}

/// Information about a single component (UseCase, Cubit, Repository, etc.)
class ComponentInfo {
  final String filePath;
  final String layer; // domain, data, presentation
  final String type; // useCases, repositories, cubit, etc.
  final String? className;
  final List<String> imports;
  final List<String> dependencies; // What this component depends on
  final List<String> methods;

  ComponentInfo({
    required this.filePath,
    required this.layer,
    required this.type,
    this.className,
    this.imports = const [],
    this.dependencies = const [],
    this.methods = const [],
  });

  factory ComponentInfo.unknown(String name) => ComponentInfo(
        filePath: 'unknown',
        layer: 'unknown',
        type: 'unknown',
        className: name,
      );
}

/// Represents a relationship between two components
class ComponentRelationship {
  final String from; // Component that depends
  final String to; // Component being depended on
  final String
      type; // Type of relationship (uses-usecase, uses-repository, etc.)

  ComponentRelationship({
    required this.from,
    required this.to,
    required this.type,
  });
}
