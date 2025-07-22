import 'dart:io';

Future<void> main(List<String> args) async {
  final result = await Process.run('fvm', [
    'dart',
    'flutter_tools/tools/gen_api.dart',
    'upcoz_flutter',
    'flutter_tools/api_testing',
  ], workingDirectory: Directory.current.path);

  if (result.exitCode != 0) {
    throw Exception('Generation failed: ${result.stderr}');
  }

  print('   Generation output: ${result.stdout}');
}
