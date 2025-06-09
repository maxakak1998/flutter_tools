import 'dart:convert';
import 'dart:io';

String root = "lib/core/api/api_routes";
String packageName = "data_entry"; // <-- Add this variable

String toPascalCase(String input) =>
    input.split('_').map((e) => e[0].toUpperCase() + e.substring(1)).join();

String toCamelCase(String input) {
  final parts = input.split('_');
  return parts.first +
      parts.skip(1).map((e) => e[0].toUpperCase() + e.substring(1)).join();
}

String dartType(dynamic value) {
  if (value is String && value == 'string') return 'String';
  if (value == 'int') return 'int';
  if (value == 'bool') return 'bool';
  if (value == 'double') return 'double';
  if (value is List && value.isNotEmpty) {
    final elementType = dartType(value.first);
    return 'List<$elementType>';
  }
  return 'dynamic';
}

String generateModel(
  String name,
  Map<String, dynamic> model,
  Map<String, String> generatedClasses, {
  bool isParent = true,
}) {
  final className = toPascalCase(name);
  if (generatedClasses.containsKey(className)) return '';
  generatedClasses[className] = className;
  final buffer = StringBuffer();

  // Only parent class extends Decoder
  if (isParent) {
    buffer.writeln('class $className extends Decoder<$className> {');
  } else {
    buffer.writeln('class $className {');
  }

  // Fields
  model.forEach((key, value) {
    if (value is Map<String, dynamic>) {
      final nestedClass = toPascalCase(name) + toPascalCase(key);
      buffer.writeln('   $nestedClass? ${toCamelCase(key)};');
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      final nestedClass = toPascalCase(name) + toPascalCase(key);
      buffer.writeln('   List<$nestedClass>? ${toCamelCase(key)};');
    } else {
      buffer.writeln('   ${dartType(value)}? ${toCamelCase(key)};');
    }
  });

  buffer.writeln();
  // Constructor
  buffer.writeln('  $className({');
  model.forEach((key, _) {
    buffer.writeln('     this.${toCamelCase(key)},');
  });
  buffer.writeln('  });\n');

  // fromJson
  buffer.writeln('  factory $className.fromJson(Map<String, dynamic> json) => $className(');
  model.forEach((key, value) {
    String type = dartType(value);
    final camelKey = toCamelCase(key);
    if (value is List && value.isNotEmpty && value.first is Map<String, dynamic>) {
      // Use the same nested class name logic as in the field declaration
      final nestedClass = toPascalCase(name) + toPascalCase(key);
      buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $nestedClass.fromJson(e)).toList(),');
    } else if (type.startsWith('List<')) {
      // Handle List<T> parsing for primitives
      final innerType = type.substring(5, type.length - 1);
      if (innerType == 'String' || innerType == 'int' || innerType == 'double' || innerType == 'bool' || innerType == 'dynamic') {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => e as $innerType).toList(),');
      } else {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $innerType.fromJson(e)).toList(),');
      }
    } else if (type == 'String' || type == 'int' || type == 'double' || type == 'bool' || type == 'dynamic') {
      buffer.writeln('    $camelKey: json[\'$key\'] as $type?,');
    } else {
      buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $type.fromJson(json[\'$key\'] as Map<String, dynamic>),');
    }
  });
  buffer.writeln('  );\n');

  // Only parent class has decode override
  if (isParent) {
    buffer.writeln('  @override');
    buffer.writeln(
      '  $className decode(Map<String, dynamic> json) => $className.fromJson(json);\n',
    );
  }

  // copyWith
  buffer.writeln('  $className copyWith({');
  model.forEach((key, value) {
    String type;
    if (value is Map<String, dynamic>) {
      type = toPascalCase(name) + toPascalCase(key);
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      type = 'List<' + toPascalCase(name) + toPascalCase(key) + '>';
    } else {
      type = dartType(value);
    }
    buffer.writeln('    $type? ${toCamelCase(key)},');
  });
  buffer.writeln('  }) {');
  buffer.writeln('    return $className(');
  model.forEach((key, _) {
    final camelKey = toCamelCase(key);
    buffer.writeln('      $camelKey: ${camelKey} ?? this.$camelKey,');
  });
  buffer.writeln('    );');
  buffer.writeln('  }\n');

  buffer.writeln('}');

  // Nested classes (isParent = false)
  model.forEach((key, value) {
    if (value is Map<String, dynamic>) {
      buffer.writeln(
        generateModel(name + toPascalCase(key), value, generatedClasses, isParent: false),
      );
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      buffer.writeln(
        generateModel(name + toPascalCase(key), value.first, generatedClasses, isParent: false),
      );
    }
  });

  return buffer.toString();
}

Future<void> main() async {
  final routeDir = Directory(root);
  final exportBuffer = StringBuffer();

  for (final entity in routeDir.listSync()) {
    if (entity is Directory) {
      final jsonFile = File('${entity.path}/api_routes.json');
      if (await jsonFile.exists()) {
        final jsonContent = jsonDecode(await jsonFile.readAsString()) as List;
        final generatedClasses = <String, String>{};

        final helperBuffer = StringBuffer(
          'class ${toPascalCase(entity.uri.pathSegments[entity.uri.pathSegments.length - 2])}ApiRoutesGenerated {\n',
        );
        final modelBuffer = StringBuffer();

        for (final api in jsonContent) {
          final name = api['name'];
          final path = api['path'];
          final method = api['method'];
          final headers = api['headers'] ?? {};
          final model = api['responseModel'] as Map<String, dynamic>?;
          final extra = api['extra'] as Map<String, dynamic>? ?? {};

          helperBuffer.writeln(
            "  static RequestOptions $name({BaseOptions? baseOption}) {",
          );
          helperBuffer.writeln("    baseOption??= BaseOptions();");

          helperBuffer.writeln("    final options = Options(");
          helperBuffer.writeln("      method: '$method',");
          if (headers.isNotEmpty)
            helperBuffer.writeln("      headers: ${jsonEncode(headers)},");
          helperBuffer.writeln("      extra: {");

          extra.forEach((k, v) {
            helperBuffer.writeln("        \"$k\": ${jsonEncode(v)},");
          });

          helperBuffer.writeln("      },");
          helperBuffer.writeln("    ).compose(baseOption, '$path');");
          helperBuffer.writeln("    return options;");
          helperBuffer.writeln("  }\n");

          if (model != null) {
            modelBuffer.writeln(generateModel(name, model, generatedClasses));
            modelBuffer.writeln();
          }
        }

        helperBuffer.writeln('}');

        final generatedFile = File('${entity.path}/api_routes_generated.dart');
        final fullOutput = '''
// GENERATED CODE - DO NOT MODIFY BY HAND

import 'package:dio/dio.dart';
import 'package:$packageName/core/api/decodable.dart';

// === RequestOptions Generator ===
${helperBuffer.toString()}

// === Models ===
${modelBuffer.toString()}
''';
        await generatedFile.writeAsString(fullOutput);

        // Add export to exportBuffer
        final relativePath = entity.path.split('lib/').last;
        exportBuffer.writeln(
          "export 'package:$packageName/$relativePath/api_routes_generated.dart';",
        );
      }
    }
  }

  // Write export file
  final exportFile = File('$root/api_route_export.dart');
  await exportFile.writeAsString(exportBuffer.toString());

  print('✅ API and model generation complete for all routes.');
}
