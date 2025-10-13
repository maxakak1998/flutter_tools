import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'abstract_connectivity_service.dart';

/// Service for monitoring network connectivity status
class ConnectivityService extends AbstractConnectivityService {
  final Connectivity _connectivity = Connectivity();
  final _connectivityController = StreamController<bool>.broadcast();
  bool _isOnline = false; // Default to true in debug mode, false in release

  /// Stream of connectivity changes, true when online, false when offline
  @override
  Stream<bool> get onConnectivityChanged => _connectivityController.stream;

  /// Current online status
  @override
  bool get isOnline => _isOnline;

  /// Current offline status
  @override
  bool get isOffline => !_isOnline;

  /// Initialize connectivity monitoring
  @override
  Future<void> initialize() async {
    // Check initial connectivity
    await checkConnectivity();

    // Listen for connectivity changes
    _connectivity.onConnectivityChanged.listen((
      List<ConnectivityResult> results,
    ) {
      // If any connection is available, consider as online
      final bool isOnline = results.any(
        (result) => result != ConnectivityResult.none,
      );
      _updateConnectivity(isOnline);
    });
  }

  /// Check current connectivity status
  @override
  Future<bool> checkConnectivity() async {
    try {
      final List<ConnectivityResult> results =
          await _connectivity.checkConnectivity();
      // If any connection is available, consider as online
      final bool isOnline = results.any(
        (result) => result != ConnectivityResult.none,
      );
      _updateConnectivity(isOnline);
      return isOnline;
    } catch (e) {
      if (kDebugMode) {
        print('Error checking connectivity: $e');
      }
      _updateConnectivity(false);
      return false;
    }
  }

  /// Update connectivity status and notify listeners
  void _updateConnectivity(bool isOnline) {
    if (_isOnline != isOnline) {
      _isOnline = isOnline;

      _connectivityController.add(isOnline);
      if (kDebugMode) {
        print('Connectivity changed: ${isOnline ? 'Online' : 'Offline'}');
      }
    }
  }

  /// Dispose resources
  @override
  void dispose() {
    _connectivityController.close();
  }
}
