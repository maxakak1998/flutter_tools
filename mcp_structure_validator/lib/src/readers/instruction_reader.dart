import 'dart:io';

/// Reads and parses instruction markdown files.
///
/// Provides methods to extract sections and content from
/// instruction files used for validation.
class InstructionReader {
  /// Cache of instruction file contents
  final Map<String, String> _cache = {};

  /// Base path for instruction files
  final String basePath;

  InstructionReader({
    this.basePath = 'flutter_tools/instructions',
  });

  /// Reads an instruction file and returns its full content.
  ///
  /// Results are cached for performance.
  ///
  /// Example:
  /// ```dart
  /// final reader = InstructionReader();
  /// final content = await reader.read('structure.instructions.md');
  /// ```
  Future<String> read(String fileName) async {
    // Check cache first
    if (_cache.containsKey(fileName)) {
      return _cache[fileName]!;
    }

    // Find the file (search from project root)
    final file = await _findInstructionFile(fileName);

    if (!await file.exists()) {
      throw InstructionFileException(
        'Instruction file not found: $fileName (searched: ${file.path})',
      );
    }

    // Read and cache
    final content = await file.readAsString();
    _cache[fileName] = content;

    return content;
  }

  /// Extracts a section from instruction content by section ID or heading.
  ///
  /// Example:
  /// ```dart
  /// final content = await reader.read('structure.instructions.md');
  /// final section = reader.extractSection(content, 'feature_structure');
  /// ```
  String? extractSection(String content, String sectionId) {
    // Try to find section by anchor (#feature_structure)
    var pattern =
        '(?:^|\\n)#{1,6}\\s+.*$sectionId.*\\n([\\s\\S]*?)(?=\\n#{1,6}|\\z)';
    var regex = RegExp(pattern, caseSensitive: false);
    var match = regex.firstMatch(content);

    if (match != null) {
      return match.group(1)?.trim();
    }

    // Try to find by exact heading match
    pattern =
        '(?:^|\\n)#{1,6}\\s+([^\\n]*$sectionId[^\\n]*)\\n([\\s\\S]*?)(?=\\n#{1,6}|\\z)';
    regex = RegExp(pattern, caseSensitive: false);
    match = regex.firstMatch(content);

    if (match != null) {
      return match.group(2)?.trim();
    }

    return null;
  }

  /// Finds specific pattern or code example in a section.
  ///
  /// Example:
  /// ```dart
  /// final pattern = reader.findPattern(section, r'lib/features/\w+/domain');
  /// ```
  String? findPattern(String content, String pattern) {
    try {
      final regex = RegExp(pattern, multiLine: true);
      final match = regex.firstMatch(content);
      return match?.group(0);
    } catch (e) {
      return null;
    }
  }

  /// Extracts all code blocks from content.
  ///
  /// Returns list of code snippets found in triple-backtick blocks.
  List<String> extractCodeBlocks(String content) {
    final regex = RegExp(
      r'```(?:\w+)?\s*\n(.*?)\n```',
      multiLine: true,
      dotAll: true,
    );

    return regex
        .allMatches(content)
        .map((match) => match.group(1)?.trim() ?? '')
        .where((code) => code.isNotEmpty)
        .toList();
  }

  /// Extracts the first code block of a specific language.
  ///
  /// Example:
  /// ```dart
  /// final dartCode = reader.extractCodeBlock(section, 'dart');
  /// ```
  String? extractCodeBlock(String content, String language) {
    final regex = RegExp(
      r'```' + language + r'\s*\n(.*?)\n```',
      multiLine: true,
      dotAll: true,
    );

    final match = regex.firstMatch(content);
    return match?.group(1)?.trim();
  }

  /// Reads section from a file directly.
  ///
  /// Convenience method that combines read() and extractSection().
  Future<String?> readSection(String fileName, String sectionId) async {
    final content = await read(fileName);
    return extractSection(content, sectionId);
  }

  /// Gets content for a specific validation proof reference.
  ///
  /// Example reference: "structure.instructions.md#feature_structure"
  Future<String?> getProofContent(String reference) async {
    final parts = reference.split('#');
    if (parts.length != 2) {
      return null;
    }

    final fileName = parts[0];
    final sectionId = parts[1];

    return await readSection(fileName, sectionId);
  }

  /// Searches for instruction file in common locations.
  Future<File> _findInstructionFile(String fileName) async {
    // Try multiple possible locations
    final possiblePaths = [
      '$basePath/$fileName',
      'flutter_tools/instructions/$fileName',
      '../../flutter_tools/instructions/$fileName',
      '../../../flutter_tools/instructions/$fileName',
    ];

    // Get current directory
    final currentDir = Directory.current.path;

    for (final relativePath in possiblePaths) {
      final file = File('$currentDir/$relativePath');
      if (await file.exists()) {
        return file;
      }
    }

    // Return the most likely path even if it doesn't exist
    // (will be caught by exists check in read())
    return File('$currentDir/$basePath/$fileName');
  }

  /// Clears the instruction cache.
  void clearCache() {
    _cache.clear();
  }

  /// Gets cache statistics.
  Map<String, int> getCacheStats() {
    return {
      'cached_files': _cache.length,
      'total_size':
          _cache.values.fold(0, (sum, content) => sum + content.length),
    };
  }
}

/// Exception thrown when instruction file operations fail.
class InstructionFileException implements Exception {
  final String message;

  InstructionFileException(this.message);

  @override
  String toString() => 'InstructionFileException: $message';
}
