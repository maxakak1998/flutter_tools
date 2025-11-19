import 'dart:io';
import 'dart:convert';

/// Test script for MCP server
void main() async {
  print('🧪 Testing MCP Structure Validator...\n');

  // Test 1: Start the server
  print('1️⃣ Starting MCP server...');
  final process = await Process.start(
    'fvm',
    ['dart', 'run', 'bin/mcp_server.dart'],
    workingDirectory: Directory.current.path,
  );

  // Listen to stderr for server logs
  process.stderr.transform(utf8.decoder).listen((data) {
    print('   [SERVER] $data');
  });

  // Give server time to start
  await Future.delayed(Duration(seconds: 1));

  // Test 2: Send validation request
  print('\n2️⃣ Sending test validation request...');
  final testRequest = {
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {
      'name': 'validate_all_features',
      'arguments': {},
    },
  };

  process.stdin.writeln(jsonEncode(testRequest));
  await process.stdin.flush();

  // Read response
  print('3️⃣ Waiting for response...\n');
  var responseReceived = false;

  process.stdout
      .transform(utf8.decoder)
      .transform(LineSplitter())
      .listen((line) {
    if (line.trim().isEmpty) return;

    try {
      final response = jsonDecode(line);
      print('✅ Response received:');
      print(JsonEncoder.withIndent('  ').convert(response));
      responseReceived = true;
    } catch (e) {
      print('   [OUTPUT] $line');
    }
  });

  // Wait for response or timeout
  var elapsed = 0;
  while (!responseReceived && elapsed < 10) {
    await Future.delayed(Duration(seconds: 1));
    elapsed++;
  }

  if (responseReceived) {
    print('\n✅ MCP server test passed!');
  } else {
    print('\n⚠️ No response received within timeout');
  }

  // Cleanup
  process.kill();
  await process.exitCode;
}
