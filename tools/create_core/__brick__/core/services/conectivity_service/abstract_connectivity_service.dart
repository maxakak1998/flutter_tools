import 'dart:async';

/// Abstract base class defining the contract for connectivity services.
/// This class provides a blueprint for implementing network connectivity 
/// monitoring functionality including status checking, change notifications,
/// and lifecycle management.
abstract class AbstractConnectivityService {
  /// Stream of connectivity changes.
  /// Emits true when device comes online, false when it goes offline.
  Stream<bool> get onConnectivityChanged;
  
  /// Current online status.
  /// Returns true if the device has network connectivity, false otherwise.
  bool get isOnline;
  
  /// Current offline status.
  /// Returns true if the device has no network connectivity, false otherwise.
  bool get isOffline;
  
  /// Initialize connectivity monitoring.
  /// This method should set up initial connectivity status checking
  /// and begin listening for connectivity changes.
  Future<void> initialize();

  /// Check current connectivity status.
  /// Returns true if the device has network connectivity, false otherwise.
  /// This method should handle errors gracefully and return false on failure.
  Future<bool> checkConnectivity();

  /// Dispose resources and clean up.
  /// This method should close streams, cancel subscriptions,
  /// and release any allocated resources.
  void dispose();
}
