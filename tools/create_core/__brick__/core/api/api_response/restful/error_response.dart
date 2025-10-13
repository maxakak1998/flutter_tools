import '../../api_export.dart';

class ErrorResponse extends BaseAPIResponseWrapper<Response, dynamic>
    implements Exception {
  late APIErrorType error;
  String? code;

  ErrorResponse({String? message, this.code}) {
    error = getErrorType(code);
  }

  ErrorResponse.fromSystem(this.error, String message) {
    hasError = true;
  }

  APIErrorType getErrorType(dynamic error) {
    if (error == "error.unauthorized") {
      return APIErrorType.unauthorized;
    }

    return APIErrorType.unknown;
  }

  @override
  String toString() {
    return 'ErrorResponse: $error  ${originalResponse?.data?.toString()}';
  }
}

enum APIErrorType { unauthorized, unknown }
