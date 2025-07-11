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
  if (value == 'int') return 'num';  // Force int to num
  if (value == 'bool') return 'bool';
  if (value == 'double') return 'num';  // Force double to num
  if (value == 'num') return 'num';
  if (value is List && value.isNotEmpty) {
    final elementType = dartType(value.first);
    return 'List<$elementType>';
  }
  return 'dynamic';
}

String generateParameterFromField(String key, Map<String, dynamic> field) {
  final type = dartType(field['type']);
  final isRequired = field['required'] == true;
  final paramName = toCamelCase(key);
  
  if (isRequired) {
    return 'required $type $paramName';
  } else {
    return '$type? $paramName';
  }
}

String generateParametersFromFields(dynamic fields, String apiName, StringBuffer modelBuffer, Map<String, String> generatedClasses) {
  if (fields == null) return '';
  
  final params = <String>[];
  
  if (fields is Map<String, dynamic>) {
    if (fields.isEmpty) return '';
    fields.forEach((key, field) {
      if (field is Map<String, dynamic>) {
        params.add(generateParameterFromField(key, field));
      }
    });
  } else if (fields is List && fields.isNotEmpty && fields.first is Map<String, dynamic>) {
    // Generate model for the list-typed body with Param suffix
    final modelName = '${toPascalCase(apiName)}Param';
    final bodyModel = fields.first as Map<String, dynamic>;
    
    // Convert field types from strings to proper structure for model generation
    final modelFields = <String, dynamic>{};
    bodyModel.forEach((key, value) {
      if (value is String) {
        // Create a proper field structure for model generation
        modelFields[key] = value; // Keep the type as string for dartType function
      }
    });
    
    // Generate the model
    modelBuffer.writeln(generateModel(modelName, modelFields, generatedClasses));
    modelBuffer.writeln();
    
    // Use the generated model as parameter
    params.add('required List<$modelName> data');
  }
  
  return params.isEmpty ? '' : ', ${params.join(', ')}';
}

String generateDataOrQueryMap(dynamic fields, String apiName) {
  if (fields == null) return '';
  
  if (fields is Map<String, dynamic>) {
    if (fields.isEmpty) return '';
    final entries = <String>[];
    fields.forEach((key, field) {
      if (field is Map<String, dynamic>) {
        final paramName = toCamelCase(key);
        entries.add('"$key": $paramName');
      }
    });
    return entries.join(', ');
  } else if (fields is List && fields.isNotEmpty) {
    // For list-typed body, convert the model list to JSON
    return 'data.map((e) => e.toJson()).toList()';
  }
  
  return '';
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
    if (value is Map<String, dynamic>) {
      // Handle nested objects
      final nestedClass = toPascalCase(name) + toPascalCase(key);
      buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $nestedClass.fromJson(json[\'$key\'] as Map<String, dynamic>),');
    } else if (value is List && value.isNotEmpty && value.first is Map<String, dynamic>) {
      // Use the same nested class name logic as in the field declaration
      final nestedClass = toPascalCase(name) + toPascalCase(key);
      buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $nestedClass.fromJson(e)).toList(),');
    } else if (type.startsWith('List<')) {
      // Handle List<T> parsing for primitives
      final innerType = type.substring(5, type.length - 1);
      if (innerType == 'String') {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => (e as String).trim()).toList(),');
      } else if (innerType == 'num' || innerType == 'bool' || innerType == 'dynamic') {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => e as $innerType).toList(),');
      } else {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $innerType.fromJson(e)).toList(),');
      }
    } else if (type == 'String') {
      buffer.writeln('    $camelKey: (json[\'$key\'] as String?)?.trim(),');
    } else if (type == 'num' || type == 'bool' || type == 'dynamic') {
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

  // toJson method
  buffer.writeln('  Map<String, dynamic> toJson() => {');
  model.forEach((key, value) {
    final camelKey = toCamelCase(key);
    if (value is Map<String, dynamic>) {
      buffer.writeln('        \'$key\': $camelKey?.toJson(),');
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      buffer.writeln('        \'$key\': $camelKey?.map((e) => e.toJson()).toList(),');
    } else {
      buffer.writeln('        \'$key\': $camelKey,');
    }
  });
  buffer.writeln('      };\n');

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

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    print('Usage: fvm dart gen_api.dart <package_name>');
    return;
  }

  packageName = args[0] ;
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
          final body = api['body']; // Remove type casting to support both Map and List
          final query = api['query'] as Map<String, dynamic>?;

          // Generate method parameters
          final bodyParams = generateParametersFromFields(body, name, modelBuffer, generatedClasses);
          final queryParams = generateParametersFromFields(query, name, modelBuffer, generatedClasses);
          final allParams = bodyParams + queryParams;

          helperBuffer.writeln(
            "  static RequestOptions $name({BaseOptions? baseOption$allParams}) {",
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
          
          // Generate the compose call with data and queryParameters if needed
          final dataMap = generateDataOrQueryMap(body, name);
          final queryMap = generateDataOrQueryMap(query, name);
          
          helperBuffer.write("    ).compose(baseOption, '$path'");
          
          if (dataMap.isNotEmpty) {
            if (dataMap.contains('data.map((e) => e.toJson()).toList()')) {
              // For list-typed body, convert to JSON
              helperBuffer.write(", data: $dataMap");
            } else {
              // For map-typed body, create the map
              helperBuffer.write(", data: {$dataMap}");
            }
          }
          
          if (queryMap.isNotEmpty) {
            helperBuffer.write(", queryParameters: {$queryMap}");
          }
          
          helperBuffer.writeln(");");
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
