import 'package:dio/dio.dart';
import 'package:http/http.dart' as http;
import 'package:{{project_name}}/core/services/secure_storage/models/auth_token.dart';
import 'package:{{project_name}}/app_export.dart';

import '../../services/manager_service/manger_service_export.dart';

/// Callback function signatures for token interceptor events
typedef OnTokenExpiredCallback = Function();
typedef OnUnauthorizedCallback = Function();
typedef OnTokenRefreshedCallback = Function(AuthToken authToken);

/// Token interceptor that handles automatic token management for API requests
///
/// This interceptor:
/// - Automatically adds Bearer tokens to authorized requests
/// - Refreshes expired access tokens using refresh tokens
/// - Handles token expiry and unauthorized scenarios via callbacks
/// - Uses HTTP client for refresh token requests (not Dio to avoid circular dependencies)
class TokenInterceptor extends QueuedInterceptorsWrapper {
  final ISecureStorageService _storageService;
  final String _baseUrl;
  final OnTokenExpiredCallback? onTokenExpired;
  final OnUnauthorizedCallback? onUnauthorized;
  final OnTokenRefreshedCallback? onTokenRefreshed;

  /// Key used in request options extra to determine if request needs authorization
  static const String authorizeKey = 'auth';

  AuthToken? _currentToken;

  TokenInterceptor({
    required ISecureStorageService storageService,
    required String baseUrl,
    this.onTokenExpired,
    this.onUnauthorized,
    this.onTokenRefreshed,
  }) : _storageService = storageService,
       _baseUrl = baseUrl;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      // Check if this request needs authorization
      final needsAuth = options.extra[authorizeKey] ?? false;
      options.baseUrl = _baseUrl;

      // Get current token if not already loaded
      _currentToken = await _storageService.getInterceptorAuthToken();

      bool isValid = true;
      // Handle case where no token exists
      if (_currentToken == null || _currentToken!.allTokensExpired) {
        isValid = false;
      } else if (_currentToken!.accessTokenExpired) {
        isValid = false;
        final refreshed = await _refreshToken();
        isValid = refreshed;
      } else if (_currentToken?.accessToken == null) {
        isValid = false;
      }
      if (!isValid && needsAuth) {
        _handleTokenExpired();
        return handler.reject(
          DioException(
            requestOptions: options,
            error: 'Failed to refresh token',
            type: DioExceptionType.unknown,
          ),
        );
      } else {
        if (_currentToken?.accessToken != null) {
          options.headers[HttpHeaders.authorizationHeader] =
              'Bearer ${_currentToken!.accessToken}';
        }
        handler.next(options);
      }
    } catch (e) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: e,
          type: DioExceptionType.unknown,
        ),
      );
    }
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Handle 401 Unauthorized responses
    if (err.response?.statusCode == 401) {
      _handleUnauthorized();
    }
    if (err.response != null) {
      handler.resolve(err.response!);
    } else {
      super.onError(err, handler);
    }
  }

  /// Refreshes the access token using the refresh token
  /// Returns true if successful, false otherwise
  Future<bool> _refreshToken() async {
    if (_currentToken?.refreshToken == null) {
      return false;
    }

    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/v1/users/refresh-token'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({'refreshToken': _currentToken!.refreshToken}),
      );

      if (response.statusCode == 200) {
        final responseData = jsonDecode(response.body);

        // Parse the new token from response
        final newToken = AuthToken.fromJson(
          responseData['data'] ?? responseData,
        );

        // Update current token
        _currentToken = newToken;

        // Save to secure storage
        final user = await _storageService.getLocalUser();
        if (user != null) {
          final updatedUser = user.copyWith(authToken: newToken);
          await _storageService.saveLocalUser(updatedUser);
        }

        // Notify via callback
        onTokenRefreshed?.call(newToken);

        return true;
      } else if (response.statusCode == 401) {
        // Refresh token is also expired
        _handleTokenExpired();
        return false;
      }
    } catch (e) {}

    return false;
  }

  /// Updates the current token (useful when user logs in)
  void updateToken(AuthToken? token) {
    _currentToken = token;
  }

  /// Clears the current token (useful when user logs out)
  void clearToken() {
    _currentToken = null;
  }

  /// Handles token expiry scenario
  void _handleTokenExpired() {
    onTokenExpired?.call();
  }

  /// Handles unauthorized scenario
  void _handleUnauthorized() {
    onUnauthorized?.call();
  }
}
