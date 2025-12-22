import 'package:equatable/equatable.dart';

class AuthToken extends Equatable {
  final String? accessToken;
  final int? accessTokenExpiry;
  final int? refreshTokenExpiry;
  final String? refreshToken;

  const AuthToken({
    this.accessToken,
    this.accessTokenExpiry,
    this.refreshToken,
    this.refreshTokenExpiry,
  });

  factory AuthToken.fromJson(Map<String, dynamic> json) {
    return AuthToken(
      accessToken: json['accessToken']?['token'],
      accessTokenExpiry: json['accessToken']?['expireAt'],
      refreshToken: json['refreshToken']?['token'],
      refreshTokenExpiry: json['refreshToken']?['expireAt'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'accessToken':
          accessToken != null
              ? {'token': accessToken, 'expireAt': accessTokenExpiry}
              : null,
      'refreshToken':
          refreshToken != null
              ? {'token': refreshToken, 'expireAt': refreshTokenExpiry}
              : null,
    };
  }

  /// Check if the access token is expired
  bool get accessTokenExpired {
    if (accessToken == null || accessTokenExpiry == null) return true;
    return DateTime.now().millisecondsSinceEpoch > (accessTokenExpiry! * 1000);
  }

  /// Check if the refresh token is expired
  bool get refreshTokenExpired {
    if (refreshToken == null || refreshTokenExpiry == null) return true;
    return DateTime.now().millisecondsSinceEpoch > (refreshTokenExpiry! * 1000);
  }

  /// Check if both tokens are expired
  bool get allTokensExpired => accessTokenExpired && refreshTokenExpired;

  /// Check if there's a valid token (at least refresh token is not expired)
  bool get hasValidToken => !refreshTokenExpired;

  AuthToken copyWith({
    String? accessToken,
    int? accessTokenExpiry,
    String? refreshToken,
    int? refreshTokenExpiry,
  }) {
    return AuthToken(
      accessToken: accessToken ?? this.accessToken,
      accessTokenExpiry: accessTokenExpiry ?? this.accessTokenExpiry,
      refreshToken: refreshToken ?? this.refreshToken,
      refreshTokenExpiry: refreshTokenExpiry ?? this.refreshTokenExpiry,
    );
  }

  @override
  List<Object?> get props => [
    accessToken,
    accessTokenExpiry,
    refreshToken,
    refreshTokenExpiry,
  ];
}
