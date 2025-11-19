# Flutter Structure Validator

AI-powered validator for Flutter Clean Architecture compliance.

## 🚀 Quick Start

### Option 1: HTTP REST API (Recommended)

**Start the server:**
```bash
dart run flutter_tools/mcp_structure_validator/bin/http_server.dart
```

Server runs on `http://localhost:8080`

**Test with Postman or curl:**

```bash
# Health check
curl http://localhost:8080/health

# Ask placement
curl -X POST http://localhost:8080/ask_placement \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "UseCase for user login with email/password",
    "purpose": "Authenticate user credentials and return auth token",
    "proposedPaths": ["lib/features/auth/domain/useCases/login_use_case.dart"],
    "componentType": "UseCase",
    "featurePath": "lib/features/auth",
    "codeOutline": "class LoginUseCase { Future<Either<Failure, AuthToken>> call(String email, String password) {} }"
  }'

# Verify implementation
curl -X POST http://localhost:8080/verify_implementation \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "lib/features/auth/domain/useCases/login_use_case.dart",
    "code": "class LoginUseCase extends ILoginUseCase {\n  final IAuthRepository repository;\n  LoginUseCase(this.repository);\n  Future<Either<Failure, AuthToken>> call(String email, String password) async {\n    return await repository.login(email, password);\n  }\n}",
    "intent": "UseCase for user login",
    "componentType": "UseCase",
    "featurePath": "lib/features/auth"
  }'
```

### Option 2: MCP Protocol (For VS Code Integration)

**Start MCP server:**
```bash
dart run flutter_tools/mcp_structure_validator/bin/mcp_server.dart
```

This uses stdin/stdout for JSON-RPC communication with VS Code MCP extension.

---

## 📡 HTTP API Reference

### `POST /ask_placement`

Validate component placement **before** creating the file.

**Request Body:**
```json
{
  "intent": "What you want to implement (one sentence)",
  "purpose": "Business reason for this code",
  "proposedPaths": ["path/to/proposed/file.dart"],
  "componentType": "UseCase|Cubit|Repository|Screen|Widget|etc",
  "featurePath": "lib/features/feature_name",
  "codeOutline": "Optional code structure sketch"
}
```

**Response:**
```json
{
  "isCorrect": true,
  "correctPath": "path/to/correct/file.dart (if isCorrect=false)",
  "explanation": "Why placement is correct/incorrect",
  "architecturalReason": "Clean Architecture principle that applies",
  "requirements": [
    "Requirement 1 to follow",
    "Requirement 2 to follow",
    "Requirement 3 to follow"
  ],
  "instructionReference": "structure.instructions.md",
  "additionalGuidance": "Extra tips or warnings"
}
```

### `POST /verify_implementation`

Verify code **after** creating the file.

**Request Body:**
```json
{
  "filePath": "lib/features/auth/domain/useCases/login_use_case.dart",
  "code": "Full Dart source code as string",
  "intent": "What you implemented",
  "componentType": "UseCase|Cubit|Repository|etc",
  "featurePath": "lib/features/feature_name"
}
```

**Response:**
```json
{
  "isValid": true,
  "filePath": "lib/features/auth/domain/useCases/login_use_case.dart",
  "rawResponse": "Detailed validation feedback from AI"
}
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "flutter-structure-validator"
}
```

---

## 🧪 Postman Collection

Import this into Postman:

**Ask Placement Example:**
- Method: `POST`
- URL: `http://localhost:8080/ask_placement`
- Headers: `Content-Type: application/json`
- Body (raw JSON):
```json
{
  "intent": "Screen for viewing and managing VIP sports betslip",
  "purpose": "Provide the main VIP betslip bottom-sheet UI where users review selections and place bets",
  "proposedPaths": ["lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart"],
  "componentType": "Screen",
  "featurePath": "lib/features/sport_betslip_vip"
}
```

**Verify Implementation Example:**
- Method: `POST`
- URL: `http://localhost:8080/verify_implementation`
- Headers: `Content-Type: application/json`
- Body (raw JSON):
```json
{
  "filePath": "lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart",
  "code": "class SportBetslipVipScreen extends StatefulWidget {\n  const SportBetslipVipScreen({super.key});\n  @override\n  State<SportBetslipVipScreen> createState() => SportBetslipVipScreenState();\n}\n\nclass SportBetslipVipScreenState extends State<SportBetslipVipScreen> {\n  // implementation\n}",
  "intent": "Screen for managing VIP betslip",
  "componentType": "Screen",
  "featurePath": "lib/features/sport_betslip_vip"
}
```

---

## 🔧 Configuration

**Environment Variables:**
- `PORT` - HTTP server port (default: 8080)
- `OLLAMA_HOST` - Ollama API URL (default: http://localhost:11434)

**Example:**
```bash
PORT=3000 dart run flutter_tools/mcp_structure_validator/bin/http_server.dart
```

---

## 📚 How It Works

1. **Startup**: Loads all instruction files (`flutter_tools/instructions/*.md`) into AI context
2. **Ask Placement**: 
   - Analyzes existing codebase structure
   - Validates proposed path against Clean Architecture patterns
   - Returns guidance with requirements
3. **Verify Implementation**:
   - Checks actual code against architectural rules
   - Validates layer separation, naming, dependencies
   - Returns validation result with suggestions

---

## 🐛 Troubleshooting

**"Ollama is not accessible"**
```bash
# Check if Ollama is running
ollama ps

# Start Ollama
ollama serve

# Pull required model
ollama pull llama3.1:8b
```

**"Instructions not found"**
- Ensure you run from the project root (`upcoz-mobile`)
- Check `flutter_tools/instructions/` folder exists

**"Port already in use"**
```bash
# Change port
PORT=3000 dart run flutter_tools/mcp_structure_validator/bin/http_server.dart

# Or kill existing process
lsof -ti:8080 | xargs kill -9
```

---

## 🎯 Integration Examples

### From Dart Code
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<void> validatePlacement() async {
  final response = await http.post(
    Uri.parse('http://localhost:8080/ask_placement'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'intent': 'UseCase for login',
      'purpose': 'Handle authentication logic',
      'proposedPaths': ['lib/features/auth/domain/useCases/login_use_case.dart'],
      'componentType': 'UseCase',
      'featurePath': 'lib/features/auth',
    }),
  );

  final result = jsonDecode(response.body);
  if (result['isCorrect']) {
    print('✅ Placement is correct!');
  } else {
    print('❌ Use this path instead: ${result['correctPath']}');
  }
}
```

### From Python
```python
import requests

response = requests.post('http://localhost:8080/ask_placement', json={
    'intent': 'UseCase for login',
    'purpose': 'Handle authentication logic',
    'proposedPaths': ['lib/features/auth/domain/useCases/login_use_case.dart'],
    'componentType': 'UseCase',
    'featurePath': 'lib/features/auth',
})

result = response.json()
print(f"Correct: {result['isCorrect']}")
print(f"Explanation: {result['explanation']}")
```

---

## 📦 Dependencies

Install dependencies:
```bash
cd flutter_tools/mcp_structure_validator
dart pub get
```

Required packages:
- `shelf` - HTTP server framework
- `shelf_router` - Request routing
- `http` - HTTP client
- `analyzer` - Dart code analysis
- `yaml` - YAML parsing

---

## 🤝 Contributing

This validator enforces:
- Clean Architecture layers (domain/data/presentation)
- UseCase pattern
- Repository pattern
- Cubit/BLoC pattern
- Go Router navigation
- Dependency injection rules

See `flutter_tools/instructions/*.md` for full architectural patterns.
