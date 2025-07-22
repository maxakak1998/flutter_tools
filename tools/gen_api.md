**This file shows how to use the `gen_api` tool to generate API documentation for Flutter.**

1. Add basic types

 ```json
 "body":{
    "email":{
        "type":"string"|"int"|"num"|"bool",
        "required":true|false
    }
 }
 ```


1. Add list type
 1. Primitives
 ```json
 "body":{
    "email":[
        {
        "type":"string"|"int"|"num"|"bool",
        "required":true|false
        }
    ]
 }
 ```
 2. List with custom type
`Lit<EmailSource> source` will be genreated
```json
 "body":{
    "email":[
        {
            "source":{
                "type":"string"|"int"|"num"|"bool",
                "required":true|false
            }
        }
    ]
 }
 ```
 3. Create a nested object
 
```json
 "body":{
    "email":{
            "type":"map",
            "value":{
                "source_name":{
                    "type":"string",
                    "required":true
                }
            }
    }
 }
 ```
This will generate:
```dart
class Email{
    final String sourceName;
    
    Email({required this.sourceName});
}