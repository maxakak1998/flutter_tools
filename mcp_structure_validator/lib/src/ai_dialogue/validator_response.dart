/// Response from the validator AI to the generator AI's placement query
///
/// Simple, focused response that tells if code is correct or what's wrong
class ValidatorResponse {
  /// Is the code correct according to architectural patterns?
  final bool isCorrect;

  /// Explanation of why the code is correct or what's wrong with it
  /// Should be clear, specific, and actionable
  final String explanation;

  /// List of instruction files used to determine correctness
  /// Example: ["structure.instructions.md", "cubit.instructions.md"]
  final List<String> instructionFiles;

  ValidatorResponse({
    required this.isCorrect,
    required this.explanation,
    required this.instructionFiles,
  });

  Map<String, dynamic> toJson() => {
        'isCorrect': isCorrect,
        'explanation': explanation,
        'instructionFiles': instructionFiles,
      };

  factory ValidatorResponse.fromJson(Map<String, dynamic> json) =>
      ValidatorResponse(
        isCorrect: json['isCorrect'] as bool,
        explanation: json['explanation'] as String,
        instructionFiles: (json['instructionFiles'] as List).cast<String>(),
      );

  /// Format as markdown for easy reading by generator AI
  String toMarkdown() {
    final buffer = StringBuffer();

    if (isCorrect) {
      buffer.writeln('✅ **Code is Correct**\n');
    } else {
      buffer.writeln('❌ **Code Has Issues**\n');
    }

    buffer.writeln('**Explanation:**');
    buffer.writeln(explanation);
    buffer.writeln();

    if (instructionFiles.isNotEmpty) {
      buffer.writeln('**Based on:**');
      for (final file in instructionFiles) {
        buffer.writeln('- $file');
      }
    }

    return buffer.toString();
  }
}
