import '../../api_export.dart';

class ErrorResponse<T> extends BaseAPIResponseWrapper<Response, T>
    implements Exception {
  late APIErrorType error;
  String? code;
  String? message;
  String? title;

  ErrorResponse({this.message, this.code, this.title, super.originalResponse}) {
    error = getErrorType(code);
    hasError = true;
  }

  ErrorResponse.fromSystem(this.error, String message) {
    hasError = true;
  }

  APIErrorType getErrorType(dynamic error) {
    return switch (error) {
      "error.unauthorized" => APIErrorType.unauthorized,
      _ => APIErrorType.unknown,
    };
  }

  @override
  String toString() {
    return message ?? 'Unknown error';
  }
}

enum APIErrorType { unauthorized, unknown }
