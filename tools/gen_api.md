# API Generator Tool Documentation

**This comprehensive guide shows how to use the `gen_api` tool to generate API documentation and Dart code for Flutter applications.**

## Table of Contents
- [Basic Usage](#basic-usage)
- [Field Types](#field-types)
- [List Types](#list-types)
- [Nested Objects](#nested-objects)
- [Advanced List Patterns](#advanced-list-patterns)
- [Query Parameters](#query-parameters)
- [Response Models](#response-models)
- [Complete Example](#complete-example)

## Basic Usage

Run the generator with:
```bash
fvm dart flutter_tools/tools/gen_api.dart <package_name> [custom_root]
```

Example:
```bash
fvm dart flutter_tools/tools/gen_api.dart upcoz_flutter lib/core/api/api_routes
```

## Field Types

### 1. Basic Primitive Types

Define basic field types in your JSON schema:

```json
{
  "body": {
    "email": {
      "type": "string",
      "required": true
    },
    "age": {
      "type": "int", 
      "required": false
    },
    "score": {
      "type": "num",
      "required": true
    },
    "isActive": {
      "type": "bool",
      "required": false
    }
  }
}
```

**Generated Dart:**
```dart
static RequestOptions methodName({
  BaseOptions? baseOption,
  required String email,
  num? age,
  required num score,
  bool? isActive,
}) { ... }
```

### 2. Supported Primitive Types
- `"string"` → `String`
- `"int"` → `num` (for flexibility)
- `"num"` → `num`
- `"bool"` → `bool`
- `"double"` → `num`

## List Types

### 1. Simple Primitive Lists (Legacy Format)

```json
{
  "body": {
    "emails": [
      {
        "type": "string",
        "required": true
      }
    ]
  }
}
```

**Generated Dart:**
```dart
required List<String> emails
```

### 2. Simple Primitive Lists (New Format)

```json
{
  "body": {
    "userIds": {
      "type": "list",
      "value": {
        "type": "int"
      }
    }
  }
}
```

**Generated Dart:**
```dart
required List<num> userIds
```

### 3. Lists with Custom Objects (Legacy Format)

```json
{
  "body": {
    "emailSources": [
      {
        "source": {
          "type": "string",
          "required": true
        },
        "verified": {
          "type": "bool",
          "required": false
        }
      }
    ]
  }
}
```

**Generated Dart:**
```dart
required List<EmailSourcesItem> emailSources

class EmailSourcesItem {
  String source;
  bool? verified;
  // ... constructor, fromJson, toJson, copyWith
}
```

## Nested Objects

### 1. Map Type with Nested Structure

```json
{
  "body": {
    "userProfile": {
      "type": "map",
      "value": {
        "firstName": {
          "type": "string",
          "required": true
        },
        "lastName": {
          "type": "string",
          "required": true
        },
        "preferences": {
          "type": "map",
          "value": {
            "theme": {
              "type": "string",
              "required": false
            },
            "notifications": {
              "type": "bool",
              "required": true
            }
          }
        }
      }
    }
  }
}
```

**Generated Dart:**
```dart
required UserProfile userProfile

class UserProfile {
  String firstName;
  String lastName;
  UserProfilePreferences? preferences;
  
  UserProfile({
    required this.firstName,
    required this.lastName,
    this.preferences,
  });
  
  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
    firstName: (json['firstName'] as String).trim(),
    lastName: (json['lastName'] as String).trim(),
    preferences: json['preferences'] == null 
      ? null 
      : UserProfilePreferences.fromJson(json['preferences'] as Map<String, dynamic>),
  );
  
  // ... copyWith, toJson methods
}

class UserProfilePreferences {
  String? theme;
  bool notifications;
  // ... complete class implementation
}
```

## Advanced List Patterns

### 1. Nested Lists with Primitives

```json
{
  "body": {
    "matrix": {
      "type": "list",
      "value": {
        "type": "list",
        "value": {
          "type": "int"
        }
      }
    }
  }
}
```

**Generated Dart:**
```dart
required List<List<num>> matrix
```

**JSON Serialization:**
```dart
"matrix": matrix?.map((e) => (e as List).map((inner) => inner).toList()).toList()
```

### 2. Nested Lists with Objects

```json
{
  "body": {
    "departments": {
      "type": "list",
      "value": {
        "type": "list",
        "value": {
          "id": {
            "type": "int"
          },
          "name": {
            "type": "string"
          },
          "head": {
            "type": "map",
            "value": {
              "employeeId": {
                "type": "int"
              },
              "fullName": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  }
}
```

**Generated Dart:**
```dart
required List<List<DepartmentsItem>> departments

class DepartmentsItem {
  num? id;
  String? name;
  DepartmentsItemHead? head;
  // ... complete implementation
}

class DepartmentsItemHead {
  num? employeeId;
  String? fullName;
  // ... complete implementation
}
```

### 3. Mixed Nested Structures

```json
{
  "body": {
    "complexData": {
      "type": "list",
      "value": {
        "sections": {
          "type": "list",
          "value": {
            "type": "string"
          }
        },
        "metadata": {
          "type": "map",
          "value": {
            "tags": {
              "type": "list",
              "value": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  }
}
```

**Generated Dart:**
```dart
required List<ComplexDataItem> complexData

class ComplexDataItem {
  List<String>? sections;
  ComplexDataItemMetadata? metadata;
  // ... complete implementation
}

class ComplexDataItemMetadata {
  List<String>? tags;
  // ... complete implementation
}
```

## Query Parameters

Query parameters work the same way as body parameters:

```json
{
  "name": "getUsers",
  "path": "/api/users",
  "method": "GET",
  "query": {
    "page": {
      "type": "int",
      "required": true
    },
    "limit": {
      "type": "int", 
      "required": true
    },
    "filters": {
      "type": "list",
      "value": {
        "type": "string"
      }
    }
  }
}
```

**Generated Dart:**
```dart
static RequestOptions getUsers({
  BaseOptions? baseOption,
  required num page,
  required num limit,
  required List<String> filters,
}) {
  // ... implementation with queryParameters
}
```

## Response Models

Define response models to generate corresponding Dart classes:

```json
{
  "name": "getUser",
  "path": "/api/users/{id}",
  "method": "GET",
  "responseModel": {
    "id": {
      "type": "int"
    },
    "profile": {
      "type": "map",
      "value": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "contacts": {
          "type": "list",
          "value": {
            "type": "string"
          }
        }
      }
    },
    "permissions": {
      "type": "list",
      "value": {
        "name": {
          "type": "string"
        },
        "level": {
          "type": "int"
        }
      }
    }
  }
}
```

**Generated Dart:**
```dart
class GetUser extends Decoder<GetUser> {
  num? id;
  GetUserProfile? profile;
  List<GetUserPermissionsItem>? permissions;

  GetUser({this.id, this.profile, this.permissions});

  factory GetUser.fromJson(Map<String, dynamic> json) => GetUser(
    id: json['id'] as num?,
    profile: json['profile'] == null 
      ? null 
      : GetUserProfile.fromJson(json['profile'] as Map<String, dynamic>),
    permissions: (json['permissions'] as List?)
      ?.map((e) => GetUserPermissionsItem.fromJson(e))
      .toList(),
  );

  @override
  GetUser decode(Map<String, dynamic> json) => GetUser.fromJson(json);

  // ... copyWith, toJson methods
}
```

## Complete Example

Here's a comprehensive API definition showcasing all features:

```json
[
  {
    "name": "createProject",
    "path": "/api/projects",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "extra": {
      "requiresAuth": true,
      "allowValueNull": false
    },
    "body": {
      "title": {
        "type": "string",
        "required": true
      },
      "description": {
        "type": "string",
        "required": false
      },
      "teamMembers": {
        "type": "list",
        "value": {
          "userId": {
            "type": "int"
          },
          "role": {
            "type": "string"
          },
          "permissions": {
            "type": "list",
            "value": {
              "type": "string"
            }
          }
        }
      },
      "settings": {
        "type": "map",
        "value": {
          "isPublic": {
            "type": "bool"
          },
          "features": {
            "type": "list",
            "value": {
              "type": "list",
              "value": {
                "name": {
                  "type": "string"
                },
                "enabled": {
                  "type": "bool"
                }
              }
            }
          }
        }
      }
    },
    "query": {
      "dryRun": {
        "type": "bool",
        "required": false
      }
    },
    "responseModel": {
      "id": {
        "type": "int"
      },
      "status": {
        "type": "string"
      },
      "createdAt": {
        "type": "string"
      }
    }
  }
]
```

**Generated Method Signature:**
```dart
static RequestOptions createProject({
  BaseOptions? baseOption,
  required String title,
  String? description,
  required List<TeamMembersItem> teamMembers,
  required Settings settings,
  bool? dryRun,
})
```

## Key Features

### 🎯 **Type Safety**
- All generated code is fully type-safe
- Proper null-safety support
- Compile-time error detection

### 🔄 **Serialization**
- Automatic JSON serialization/deserialization
- Handles nested structures correctly
- Optimized for performance

### 🧹 **Code Generation**
- Clean, readable generated code
- Follows Dart conventions
- Includes documentation

### 🛠 **Flexibility**
- Supports both legacy and new JSON formats
- Handles complex nested structures
- Extensible for future requirements

### 📝 **Generated Methods Include**
- Constructor with named parameters
- `fromJson` factory constructor
- `toJson` method for serialization
- `copyWith` method for immutable updates
- `decode` method for response models

## Best Practices

1. **Use descriptive field names** - they become class and parameter names
2. **Mark required fields appropriately** - affects null-safety
3. **Prefer the new list format** `{"type": "list", "value": {...}}` for complex lists
4. **Use map types** for structured nested objects
5. **Keep nesting levels reasonable** - deeply nested structures can be hard to maintain
6. **Test generated code** - always verify the output compiles and works as expected

## Migration Guide

### From Legacy List Format
**Old:**
```json
"emails": [{"type": "string", "required": true}]
```

**New:**
```json
"emails": {
  "type": "list",
  "value": {
    "type": "string"
  }
}
```

### Benefits of New Format
- More consistent with other type definitions
- Better support for nested lists
- Clearer intent and structure
- Enhanced tooling support