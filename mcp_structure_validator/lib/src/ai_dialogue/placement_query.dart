/// Represents a question from the generator AI to the validator AI
///
/// The generator AI asks the validator AI for guidance BEFORE writing code:
/// "I want to implement X with purpose Y. Where should I place this code?"
///
/// The validator AI then checks instructions and responds with guidance.
class PlacementQuery {
  /// What the generator AI wants to implement
  /// Example: "UseCase that fetches user profile"
  final String intent;

  /// The purpose/responsibility of this code
  /// Example: "Handle business logic for profile retrieval"
  final String purpose;

  /// Proposed file path(s) the generator is considering
  /// Example: ["domain/useCases/GetUserProfileUseCase.dart"]
  final List<String> proposedPaths;

  /// Component type (UseCase, Cubit, Repository, etc.)
  final String componentType;

  /// Feature context
  final String featurePath;

  /// Optional: Skeleton/pseudo-code of what will be implemented
  final String? codeOutline;

  PlacementQuery({
    required this.intent,
    required this.purpose,
    required this.proposedPaths,
    required this.componentType,
    required this.featurePath,
    this.codeOutline,
  });

  Map<String, dynamic> toJson() => {
        'intent': intent,
        'purpose': purpose,
        'proposedPaths': proposedPaths,
        'componentType': componentType,
        'featurePath': featurePath,
        'codeOutline': codeOutline,
      };

  factory PlacementQuery.fromJson(Map<String, dynamic> json) => PlacementQuery(
        intent: json['intent'] as String,
        purpose: json['purpose'] as String,
        proposedPaths: (json['proposedPaths'] as List).cast<String>(),
        componentType: json['componentType'] as String,
        featurePath: json['featurePath'] as String,
        codeOutline: json['codeOutline'] as String?,
      );
}
