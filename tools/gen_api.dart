import 'dart:convert';
import 'dart:io';

String root = "lib/core/api/api_routes";
String packageName = "data_entry"; // <-- Add this variable

String toPascalCase(String input) =>
    input.split('_').where((e) => e.isNotEmpty).map((e) => e[0].toUpperCase() + e.substring(1)).join();

String toCamelCase(String input) {
  final parts = input.split('_').where((e) => e.isNotEmpty).toList();
  if (parts.isEmpty) return '';
  return parts.first +
      parts.skip(1).map((e) => e[0].toUpperCase() + e.substring(1)).join();
}

String dartType(dynamic value) {
  if (value is String && value == 'string') return 'String';
  if (value == 'int') return 'num';  // Force int to num
  if (value == 'bool') return 'bool';
  if (value == 'double') return 'num';  // Force double to num
  if (value == 'num') return 'num';
  if (value == 'map') return 'Map<String, dynamic>';
  if (value is List && value.isNotEmpty) {
    final elementType = dartType(value.first);
    return 'List<$elementType>';
  }
  return 'dynamic';
}

String generateParameterFromField(String key, Map<String, dynamic> field, String apiName, StringBuffer modelBuffer, Map<String, String> generatedClasses) {
  final type = field['type'];
  final isRequired = field['required'] == true;
  final paramName = toCamelCase(key);
  
  String dartTypeResult;
  
  // Handle Map type with value definition
  if (type == 'map' && field['value'] is Map<String, dynamic>) {
    final className = '${toPascalCase(key)}Params';
    final valueMap = field['value'] as Map<String, dynamic>;
    
    // Process the map value recursively (for body parameters, not responseModel)
    final processedFields = processFieldDefinitions(valueMap, className, isResponseModel: false);
    
    // Generate the class for the Map value
    modelBuffer.writeln(generateModel(className, processedFields, generatedClasses, isParent: false));
    modelBuffer.writeln();
    
    dartTypeResult = className;
  } else {
    dartTypeResult = dartType(type);
  }
  
  if (isRequired) {
    return 'required $dartTypeResult $paramName';
  } else {
    return '$dartTypeResult? $paramName';
  }
}

// Recursive function to process field definitions and convert them to model-ready format
Map<String, dynamic> processFieldDefinitions(Map<String, dynamic> fields, String contextName, {bool isResponseModel = false}) {
  final processedFields = <String, dynamic>{};
  
  fields.forEach((key, value) {
    if (value is Map<String, dynamic>) {
      if (value.containsKey('type')) {
        // This is a field definition
        final fieldType = value['type'];
        // For responseModel, ignore required property; for body/query, use it
        final isRequired = isResponseModel ? false : (value['required'] != false);
        
        if (fieldType == 'map' && value.containsKey('value')) {
          // Nested map - create a nested class
          final nestedClassName = '${toPascalCase(contextName)}${toPascalCase(key)}';
          final nestedFields = processFieldDefinitions(value['value'], nestedClassName, isResponseModel: isResponseModel);
          
          processedFields[key] = {
            '_classType': nestedClassName,
            '_optional': !isRequired,
            '_nestedFields': nestedFields
          };
        } else {
          // Regular field with type and required
          processedFields[key] = {
            '_fieldType': fieldType,
            '_optional': !isRequired
          };
        }
      } else {
        // This might be a nested structure without explicit type
        processedFields[key] = value;
      }
    } else if (value is List && value.isNotEmpty) {
      // Handle arrays
      processedFields[key] = processArrayField(value, key, contextName, isResponseModel: isResponseModel);
    } else {
      // Primitive value or unknown structure
      processedFields[key] = value;
    }
  });
  
  return processedFields;
}

// Process array field definitions
dynamic processArrayField(List<dynamic> arrayValue, String key, String contextName, {bool isResponseModel = false}) {
  if (arrayValue.isEmpty) return arrayValue;
  
  final firstItem = arrayValue.first;
  
  if (firstItem is Map<String, dynamic>) {
    // Check if this is a simple schema definition like [{"type": "string", "required": true}]
    final keys = firstItem.keys.toSet();
    final hasTypeKey = keys.contains('type');
    final typeValue = firstItem['type'];
    
    // Schema definition must have 'type' as a STRING value, not a Map
    final isSchemaDefinition = hasTypeKey && 
                               typeValue is String && // Type must be a string, not a Map
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required')) &&
                               !firstItem.containsKey('value'); // Not a nested map
    
    if (isSchemaDefinition) {
      // Simple schema definition - return as array type metadata
      return {
        '_arraySchemaType': firstItem['type'],
        '_arrayRequired': firstItem['required'] != false
      };
    } else {
      // Complex object structure in array - process recursively
      final itemClassName = '${toPascalCase(contextName)}${toPascalCase(key)}Item';
      final processedItem = processFieldDefinitions(firstItem, itemClassName, isResponseModel: isResponseModel);
      
      return {
        '_arrayItemClass': itemClassName,
        '_arrayItemFields': processedItem
      };
    }
  } else {
    // Array of primitives
    return arrayValue;
  }
}

String generateParametersFromFields(dynamic fields, String apiName, StringBuffer modelBuffer, Map<String, String> generatedClasses, {bool allowMapTypes = false}) {
  if (fields == null) return '';
  
  final params = <String>[];
  
  if (fields is Map<String, dynamic>) {
    if (fields.isEmpty) return '';
    
    // Process all fields recursively (for body/query/params, not responseModel)
    final processedFields = processFieldDefinitions(fields, apiName, isResponseModel: false);
    
    // Generate all nested classes first
    generateNestedClasses(processedFields, modelBuffer, generatedClasses, apiName);
    
    // Generate parameters
    processedFields.forEach((key, field) {
      if (field is Map<String, dynamic>) {
        if (field.containsKey('_fieldType')) {
          final fieldType = dartType(field['_fieldType']);
          final isOptional = field['_optional'] ?? true;
          final paramName = toCamelCase(key);
          
          if (isOptional) {
            params.add('$fieldType? $paramName');
          } else {
            params.add('required $fieldType $paramName');
          }
        } else if (field.containsKey('_classType')) {
          final className = field['_classType'];
          final isOptional = field['_optional'] ?? true;
          final paramName = toCamelCase(key);
          
          if (isOptional) {
            params.add('$className? $paramName');
          } else {
            params.add('required $className $paramName');
          }
        } else if (field.containsKey('_arraySchemaType')) {
          final itemType = dartType(field['_arraySchemaType']);
          final paramName = toCamelCase(key);
          params.add('required List<$itemType> $paramName');
        } else if (field.containsKey('_arrayItemClass')) {
          final itemClass = field['_arrayItemClass'];
          final paramName = toCamelCase(key);
          params.add('required List<$itemClass> $paramName');
        }
      }
    });
  } else if (fields is List && fields.isNotEmpty && fields.first is Map<String, dynamic>) {
    // Generate model for the list-typed body with Param suffix
    final modelName = '${toPascalCase(apiName)}Param';
    final bodyModel = fields.first as Map<String, dynamic>;
    
    // Process recursively (for body parameters, not responseModel)
    final processedFields = processFieldDefinitions(bodyModel, modelName, isResponseModel: false);
    
    // Generate nested classes
    generateNestedClasses(processedFields, modelBuffer, generatedClasses, modelName);
    
    // Generate the main model
    modelBuffer.writeln(generateModel(modelName, processedFields, generatedClasses));
    modelBuffer.writeln();
    
    // Use the generated model as parameter
    params.add('required List<$modelName> data');
  }
  
  return params.isEmpty ? '' : ', ${params.join(', ')}';
}

// Generate all nested classes recursively
void generateNestedClasses(Map<String, dynamic> processedFields, StringBuffer modelBuffer, Map<String, String> generatedClasses, String contextName) {
  processedFields.forEach((key, field) {
    // Skip metadata fields that start with underscore
    if (key.startsWith('_')) {
      return;
    }
    
    if (field is Map<String, dynamic>) {
      if (field.containsKey('_nestedFields')) {
        final className = field['_classType'];
        final nestedFields = field['_nestedFields'];
        
        // Generate nested classes first (depth-first)
        generateNestedClasses(nestedFields, modelBuffer, generatedClasses, className);
        
        // Then generate this class
        modelBuffer.writeln(generateModel(className, nestedFields, generatedClasses, isParent: false));
        modelBuffer.writeln();
      } else if (field.containsKey('_arrayItemFields')) {
        final itemClass = field['_arrayItemClass'];
        final itemFields = field['_arrayItemFields'];
        
        // Generate nested classes for array item first
        generateNestedClasses(itemFields, modelBuffer, generatedClasses, itemClass);
        
        // Then generate array item class
        modelBuffer.writeln(generateModel(itemClass, itemFields, generatedClasses, isParent: false));
        modelBuffer.writeln();
      }
      // Skip fields that only contain array metadata like _arraySchemaType
      // These should not generate classes
    }
  });
}

String generateDataOrQueryMap(dynamic fields, String apiName) {
  if (fields == null) return '';
  
  if (fields is Map<String, dynamic>) {
    if (fields.isEmpty) return '';
    final entries = <String>[];
    fields.forEach((key, field) {
      if (field is Map<String, dynamic>) {
        final paramName = toCamelCase(key);
        final type = field['type'];
        
        // Handle Map type with value definition  
        if (type == 'map' && field['value'] is Map<String, dynamic>) {
          entries.add('"$key": $paramName?.toJson()');
        } else {
          entries.add('"$key": $paramName');
        }
      } else if (field is List && field.isNotEmpty && field.first is Map<String, dynamic>) {
        // Handle array fields like "requests": [{ ... }]
        final paramName = toCamelCase(key);
        entries.add('"$key": $paramName.map((e) => e.toJson()).toList()');
      }
    });
    return entries.join(', ');
  } else if (fields is List && fields.isNotEmpty) {
    // For list-typed body, convert the model list to JSON
    return 'data.map((e) => e.toJson()).toList()';
  }
  
  return '';
}

String generateRemoveNullFunction() {
  return '''
  // Helper function to remove null values from maps
  static Map<String, dynamic> _removeNullValues(Map<String, dynamic> map) {
    final result = <String, dynamic>{};
    map.forEach((key, value) {
      if (value != null && value != '') {
        if (value is Map<String, dynamic>) {
          final cleanedMap = _removeNullValues(value);
          if (cleanedMap.isNotEmpty) {
            result[key] = cleanedMap;
          }
        } else if (value is List) {
          final cleanedList = value.where((item) => item != null && item != '').toList();
          if (cleanedList.isNotEmpty) {
            result[key] = cleanedList;
          }
        } else {
          result[key] = value;
        }
      }
    });
    return result;
  }
''';
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
    if (value is Map<String, dynamic> && value.containsKey('_classType')) {
      // Handle custom class types (like nested maps)
      final className = value['_classType'];
      final isOptional = value['_optional'] ?? true;
      final fieldType = isOptional ? '$className?' : className;
      buffer.writeln('   $fieldType ${toCamelCase(key)};');
    } else if (value is Map<String, dynamic> && value.containsKey('_fieldType')) {
      // Handle field types with required information
      final fieldType = dartType(value['_fieldType']);
      final isOptional = value['_optional'] ?? true;
      final finalType = isOptional ? '$fieldType?' : fieldType;
      buffer.writeln('   $finalType ${toCamelCase(key)};');
    } else if (value is Map<String, dynamic> && value.containsKey('_arraySchemaType')) {
      // Handle array with schema definition like [{"type": "string", "required": true}]
      final itemType = dartType(value['_arraySchemaType']);
      buffer.writeln('   List<$itemType>? ${toCamelCase(key)};');
    } else if (value is Map<String, dynamic> && value.containsKey('_arrayItemClass')) {
      // Handle array with complex item class
      final itemClass = value['_arrayItemClass'];
      buffer.writeln('   List<$itemClass>? ${toCamelCase(key)};');
    } else if (value is Map<String, dynamic>) {
      // Check if this is a field definition (backward compatibility)
      final keys = value.keys.toSet();
      final isFieldDefinition = keys.contains('type') && 
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required'));
      
      if (isFieldDefinition) {
        // This is a field definition like {"type": "string", "required": true}
        final fieldType = value['type'] as String;
        final isRequired = value['required'] != false;  // Default to true if not specified
        final dartFieldType = dartType(fieldType);
        final finalType = isRequired ? dartFieldType : '$dartFieldType?';
        buffer.writeln('   $finalType ${toCamelCase(key)};');
      } else {
        // This is a nested object, create nested class
        final nestedClass = toPascalCase(name) + toPascalCase(key);
        buffer.writeln('   $nestedClass? ${toCamelCase(key)};');
      }
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      // Check if this is a schema definition (has 'type' and 'required' keys only)
      final firstItem = value.first as Map<String, dynamic>;
      final keys = firstItem.keys.toSet();
      final isSchemaDefinition = keys.contains('type') && 
                                keys.length <= 2 && 
                                (keys.length == 1 || keys.contains('required'));
      
      if (isSchemaDefinition) {
        // This is a schema definition like [{"type": "string", "required": true}]
        // Convert to the appropriate List type
        final itemType = firstItem['type'] as String;
        final isRequired = firstItem['required'] != false;  // Default to true if not specified
        final dartItemType = dartType(itemType);
        final listType = isRequired ? 'List<$dartItemType>' : 'List<$dartItemType>?';
        buffer.writeln('   $listType? ${toCamelCase(key)};');
      } else {
        // This is actual data structure, create nested class
        final nestedClass = toPascalCase(name) + toPascalCase(key);
        buffer.writeln('   List<$nestedClass>? ${toCamelCase(key)};');
      }
    } else {
      buffer.writeln('   ${dartType(value)}? ${toCamelCase(key)};');
    }
  });

  buffer.writeln();
  // Constructor
  buffer.writeln('  $className({');
  model.forEach((key, value) {
    final camelKey = toCamelCase(key);
    bool isRequired = false;
    
    if (value is Map<String, dynamic> && value.containsKey('_fieldType')) {
      isRequired = !(value['_optional'] ?? true);
    } else if (value is Map<String, dynamic> && value.containsKey('_classType')) {
      isRequired = !(value['_optional'] ?? true);
    } else if (value is Map<String, dynamic>) {
      // Check if this is a field definition
      final keys = value.keys.toSet();
      final isFieldDefinition = keys.contains('type') && 
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required'));
      if (isFieldDefinition) {
        isRequired = value['required'] != false;  // Default to true if not specified
      }
    }
    
    if (isRequired) {
      buffer.writeln('     required this.$camelKey,');
    } else {
      buffer.writeln('     this.$camelKey,');
    }
  });
  buffer.writeln('  });\n');

  // fromJson
  buffer.writeln('  factory $className.fromJson(Map<String, dynamic> json) => $className(');
  model.forEach((key, value) {
    final camelKey = toCamelCase(key);
    if (value is Map<String, dynamic> && value.containsKey('_classType')) {
      // Handle custom class types (like nested objects)
      final className = value['_classType'];
      final isOptional = value['_optional'] ?? true;
      
      if (isOptional) {
        buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $className.fromJson(json[\'$key\'] as Map<String, dynamic>),');
      } else {
        buffer.writeln('    $camelKey: $className.fromJson(json[\'$key\'] as Map<String, dynamic>),');
      }
    } else if (value is Map<String, dynamic> && value.containsKey('_fieldType')) {
      // Handle field types with required information
      final fieldType = value['_fieldType'];
      final isOptional = value['_optional'] ?? true;
      final type = dartType(fieldType);
      
      if (isOptional) {
        if (type == 'String') {
          buffer.writeln('    $camelKey: (json[\'$key\'] as String?)?.trim(),');
        } else if (type == 'num' || type == 'bool' || type == 'dynamic') {
          buffer.writeln('    $camelKey: json[\'$key\'] as $type?,');
        } else {
          buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $type.fromJson(json[\'$key\'] as Map<String, dynamic>),');
        }
      } else {
        // Required field - no null check
        if (type == 'String') {
          buffer.writeln('    $camelKey: (json[\'$key\'] as String).trim(),');
        } else if (type == 'num' || type == 'bool' || type == 'dynamic') {
          buffer.writeln('    $camelKey: json[\'$key\'] as $type,');
        } else {
          buffer.writeln('    $camelKey: $type.fromJson(json[\'$key\'] as Map<String, dynamic>),');
        }
      }
    } else if (value is Map<String, dynamic> && value.containsKey('_arraySchemaType')) {
      // Handle array with schema definition like [{"type": "string", "required": true}]
      final itemType = dartType(value['_arraySchemaType']);
      if (itemType == 'String') {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => (e as String).trim()).toList(),');
      } else if (itemType == 'num' || itemType == 'bool' || itemType == 'dynamic') {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => e as $itemType).toList(),');
      } else {
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.cast<$itemType>(),');
      }
    } else if (value is Map<String, dynamic> && value.containsKey('_arrayItemClass')) {
      // Handle array with complex item class
      final itemClass = value['_arrayItemClass'];
      buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $itemClass.fromJson(e)).toList(),');
    } else if (value is Map<String, dynamic>) {
      // Check if this is a field definition (has 'type' and 'required' keys only)
      final keys = value.keys.toSet();
      final isFieldDefinition = keys.contains('type') && 
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required'));
      
      if (isFieldDefinition) {
        // This is a field definition like {"type": "string", "required": true}
        final fieldType = value['type'] as String;
        final isRequired = value['required'] != false;
        final dartFieldType = dartType(fieldType);
        
        if (isRequired) {
          if (dartFieldType == 'String') {
            buffer.writeln('    $camelKey: (json[\'$key\'] as String).trim(),');
          } else if (dartFieldType == 'num' || dartFieldType == 'bool' || dartFieldType == 'dynamic') {
            buffer.writeln('    $camelKey: json[\'$key\'] as $dartFieldType,');
          } else {
            buffer.writeln('    $camelKey: $dartFieldType.fromJson(json[\'$key\'] as Map<String, dynamic>),');
          }
        } else {
          if (dartFieldType == 'String') {
            buffer.writeln('    $camelKey: (json[\'$key\'] as String?)?.trim(),');
          } else if (dartFieldType == 'num' || dartFieldType == 'bool' || dartFieldType == 'dynamic') {
            buffer.writeln('    $camelKey: json[\'$key\'] as $dartFieldType?,');
          } else {
            buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $dartFieldType.fromJson(json[\'$key\'] as Map<String, dynamic>),');
          }
        }
      } else {
        // Handle nested objects
        final nestedClass = toPascalCase(name) + toPascalCase(key);
        buffer.writeln('    $camelKey: json[\'$key\'] == null ? null : $nestedClass.fromJson(json[\'$key\'] as Map<String, dynamic>),');
      }
    } else if (value is List && value.isNotEmpty && value.first is Map<String, dynamic>) {
      // Check if this is a schema definition (has 'type' and 'required' keys only)
      final firstItem = value.first as Map<String, dynamic>;
      final keys = firstItem.keys.toSet();
      final isSchemaDefinition = keys.contains('type') && 
                                keys.length <= 2 && 
                                (keys.length == 1 || keys.contains('required'));
      
      if (isSchemaDefinition) {
        // This is a schema definition like [{"type": "string", "required": true}]
        // Parse as primitive list
        final itemType = firstItem['type'] as String;
        final dartItemType = dartType(itemType);
        if (dartItemType == 'String') {
          buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => (e as String).trim()).toList(),');
        } else if (dartItemType == 'num' || dartItemType == 'bool' || dartItemType == 'dynamic') {
          buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => e as $dartItemType).toList(),');
        } else {
          buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.cast<$dartItemType>(),');
        }
      } else {
        // This is actual data structure, create nested class
        final nestedClass = toPascalCase(name) + toPascalCase(key);
        buffer.writeln('    $camelKey: (json[\'$key\'] as List?)?.map((e) => $nestedClass.fromJson(e)).toList(),');
      }
    } else {
      String type = dartType(value);
      if (type.startsWith('List<')) {
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
    if (value is Map<String, dynamic> && value.containsKey('_classType')) {
      // Handle custom class types (like UsedBoostData)
      type = value['_classType'];
    } else if (value is Map<String, dynamic> && value.containsKey('_fieldType')) {
      // Handle field types with required information
      type = dartType(value['_fieldType']);
    } else if (value is Map<String, dynamic> && value.containsKey('_arraySchemaType')) {
      // Handle array with schema definition like [{"type": "string", "required": true}]
      final itemType = dartType(value['_arraySchemaType']);
      type = 'List<$itemType>';
    } else if (value is Map<String, dynamic> && value.containsKey('_arrayItemClass')) {
      // Handle array with complex item class
      final itemClass = value['_arrayItemClass'];
      type = 'List<$itemClass>';
    } else if (value is Map<String, dynamic>) {
      // Check if this is a field definition (has 'type' and 'required' keys only)
      final keys = value.keys.toSet();
      final isFieldDefinition = keys.contains('type') && 
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required'));
      
      if (isFieldDefinition) {
        // This is a field definition like {"type": "string", "required": true}
        type = dartType(value['type']);
      } else {
        // This is a nested object, create nested class
        type = toPascalCase(name) + toPascalCase(key);
      }
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      // Check if this is a schema definition (has 'type' and 'required' keys only)
      final firstItem = value.first as Map<String, dynamic>;
      final keys = firstItem.keys.toSet();
      final isSchemaDefinition = keys.contains('type') && 
                                keys.length <= 2 && 
                                (keys.length == 1 || keys.contains('required'));
      
      if (isSchemaDefinition) {
        // This is a schema definition like [{"type": "string", "required": true}]
        final itemType = firstItem['type'] as String;
        final dartItemType = dartType(itemType);
        type = 'List<$dartItemType>';
      } else {
        // This is actual data structure, create nested class
        type = 'List<' + toPascalCase(name) + toPascalCase(key) + '>';
      }
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
    if (value is Map<String, dynamic> && value.containsKey('_classType')) {
      // Handle custom class types (like UsedBoostData)
      buffer.writeln('        \'$key\': $camelKey?.toJson(),');
    } else if (value is Map<String, dynamic> && value.containsKey('_fieldType')) {
      // Handle field types with required information (primitive types)
      buffer.writeln('        \'$key\': $camelKey,');
    } else if (value is Map<String, dynamic> && value.containsKey('_arraySchemaType')) {
      // Handle array with schema definition like [{"type": "string", "required": true}]
      buffer.writeln('        \'$key\': $camelKey,');
    } else if (value is Map<String, dynamic> && value.containsKey('_arrayItemClass')) {
      // Handle array with complex item class
      buffer.writeln('        \'$key\': $camelKey?.map((e) => e.toJson()).toList(),');
    } else if (value is Map<String, dynamic>) {
      // Check if this is a field definition (has 'type' and 'required' keys only)
      final keys = value.keys.toSet();
      final isFieldDefinition = keys.contains('type') && 
                               keys.length <= 2 && 
                               (keys.length == 1 || keys.contains('required'));
      
      if (isFieldDefinition) {
        // This is a field definition like {"type": "string", "required": true}
        // Serialize as primitive value
        buffer.writeln('        \'$key\': $camelKey,');
      } else {
        // This is a nested object, serialize with toJson
        buffer.writeln('        \'$key\': $camelKey?.toJson(),');
      }
    } else if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      // Check if this is a schema definition (has 'type' and 'required' keys only)
      final firstItem = value.first as Map<String, dynamic>;
      final keys = firstItem.keys.toSet();
      final isSchemaDefinition = keys.contains('type') && 
                                keys.length <= 2 && 
                                (keys.length == 1 || keys.contains('required'));
      
      if (isSchemaDefinition) {
        // This is a schema definition like [{"type": "string", "required": true}]
        // Serialize as primitive list
        buffer.writeln('        \'$key\': $camelKey,');
      } else {
        // This is actual data structure, serialize with toJson
        buffer.writeln('        \'$key\': $camelKey?.map((e) => e.toJson()).toList(),');
      }
    } else {
      buffer.writeln('        \'$key\': $camelKey,');
    }
  });
  buffer.writeln('      };\n');

  buffer.writeln('}');

  // Nested classes (isParent = false)
  return buffer.toString();
}

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    print('Usage: fvm dart gen_api.dart <package_name> [custom_root]');
    return;
  }

  packageName = args[0];
  
  // If a custom root is provided as second argument, use it
  if (args.length > 1) {
    root = args[1];
  }
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
        
        // Add the helper function to remove null values
        helperBuffer.writeln(generateRemoveNullFunction());
        
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
          final params = api['params'] as Map<String, dynamic>?; // Add support for params

          // Generate method parameters
          final bodyParams = generateParametersFromFields(body, name, modelBuffer, generatedClasses, allowMapTypes: true);
          final queryParams = generateParametersFromFields(query, name, modelBuffer, generatedClasses, allowMapTypes: false);
          final paramsParams = generateParametersFromFields(params, name, modelBuffer, generatedClasses, allowMapTypes: false);
          final allParams = bodyParams + queryParams + paramsParams;

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
          final paramsMap = generateDataOrQueryMap(params, name);
          
          helperBuffer.write("    ).compose(baseOption, '$path'");
          
          // Check if allowValueNull is true in extra field
          final allowValueNull = extra['allowValueNull'] == true;
          
          if (dataMap.isNotEmpty) {
            if (dataMap.contains('data.map((e) => e.toJson()).toList()')) {
              // For list-typed body, convert to JSON
              if (allowValueNull) {
                helperBuffer.write(", data: $dataMap");
              } else {
                helperBuffer.write(", data: $dataMap"); // List data filtering would need to be handled differently
              }
            } else {
              // For map-typed body, create the map and optionally filter nulls
              if (allowValueNull) {
                helperBuffer.write(", data: {$dataMap}");
              } else {
                helperBuffer.write(", data: _removeNullValues({$dataMap})");
              }
            }
          }
          
          // Handle both query and params for queryParameters
          final allQueryMaps = [queryMap, paramsMap].where((m) => m.isNotEmpty).toList();
          if (allQueryMaps.isNotEmpty) {
            final combinedQueryMap = allQueryMaps.join(', ');
            if (allowValueNull) {
              helperBuffer.write(", queryParameters: {$combinedQueryMap}");
            } else {
              helperBuffer.write(", queryParameters: _removeNullValues({$combinedQueryMap})");
            }
          }
          
          helperBuffer.writeln(");");
          helperBuffer.writeln("    return options;");
          helperBuffer.writeln("  }\n");

          if (model != null) {
            // Process the model fields recursively before generating
            final processedModel = processFieldDefinitions(model, name, isResponseModel: true);
            modelBuffer.writeln(generateModel(name, processedModel, generatedClasses));
            // Generate nested classes for the processed model
            generateNestedClasses(processedModel, modelBuffer, generatedClasses, name);
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
