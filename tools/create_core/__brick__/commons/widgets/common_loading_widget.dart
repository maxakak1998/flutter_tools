import 'package:flutter/material.dart';
import 'package:flutter_easyloading/flutter_easyloading.dart';
import '../../app_export.dart';

/// CommonLoadingWidget - A centralized loading widget using flutter_easyloading
/// 
/// This widget provides a consistent loading experience across the app using flutter_easyloading package.
/// It supports different loading types, custom messages, and theme-aware styling.
/// 
/// Features:
/// - Overlay loading with customizable messages
/// - Progress indicators for long-running operations
/// - Theme-aware styling that follows the app's design system
/// - Static methods for easy usage throughout the app
/// - Proper initialization and configuration
/// 
/// Usage:
/// ```dart
/// // Show simple loading
/// CommonLoadingWidget.show();
/// 
/// // Show loading with custom message
/// CommonLoadingWidget.show(message: 'Uploading photos...');
/// 
/// // Show progress loading
/// CommonLoadingWidget.showProgress(0.5, message: 'Processing...');
/// 
/// // Hide loading
/// CommonLoadingWidget.dismiss();
/// ```
class CommonLoadingWidget {
  
  /// Initialize EasyLoading with theme-aware configuration
  /// Call this in main.dart or app initialization
  static void initialize() {
    final ITheme currentTheme = GetIt.I<MainAppCubit>().currentTheme;
    
    EasyLoading.instance
      ..displayDuration = const Duration(milliseconds: 2000)
      ..indicatorType = EasyLoadingIndicatorType.fadingCircle
      ..loadingStyle = EasyLoadingStyle.custom
      ..indicatorSize = 45.0
      ..radius = 10.0
      ..progressColor = currentTheme.primaryColor
      ..backgroundColor = Colors.white
      ..indicatorColor = currentTheme.primaryColor
      ..textColor = currentTheme.primaryTextColor
      ..maskColor = Colors.black.withOpacity(0.5)
      ..userInteractions = false
      ..dismissOnTap = false
      ..fontSize = 14.sp
      ..contentPadding = EdgeInsets.symmetric(
        vertical: 15.h,
        horizontal: 20.w,
      );
  }

  /// Show simple loading overlay
  /// 
  /// [message] - Optional message to display below the loading indicator
  /// [maskType] - Type of mask to apply (default: black)
  static void show({
    String? message,
    EasyLoadingMaskType maskType = EasyLoadingMaskType.black,
  }) {
    EasyLoading.show(
      status: message ?? 'Loading...',
      maskType: maskType,
    );
  }

  /// Show loading with progress indicator
  /// 
  /// [progress] - Progress value between 0.0 and 1.0
  /// [message] - Optional message to display
  /// [maskType] - Type of mask to apply
  static void showProgress(
    double progress, {
    String? message,
    EasyLoadingMaskType maskType = EasyLoadingMaskType.black,
  }) {
    EasyLoading.showProgress(
      progress,
      status: message ?? '${(progress * 100).toInt()}%',
      maskType: maskType,
    );
  }

  /// Show success message with checkmark
  /// 
  /// [message] - Success message to display
  /// [duration] - How long to show the success message
  static void showSuccess(
    String message, {
    Duration? duration,
  }) {
    EasyLoading.showSuccess(
      message,
      duration: duration ?? const Duration(seconds: 2),
      maskType: EasyLoadingMaskType.black,
    );
  }

  /// Show error message with error icon
  /// 
  /// [message] - Error message to display
  /// [duration] - How long to show the error message
  static void showError(
    String message, {
    Duration? duration,
  }) {
    EasyLoading.showError(
      message,
      duration: duration ?? const Duration(seconds: 3),
      maskType: EasyLoadingMaskType.black,
    );
  }

  /// Show info message with info icon
  /// 
  /// [message] - Info message to display
  /// [duration] - How long to show the info message
  static void showInfo(
    String message, {
    Duration? duration,
  }) {
    EasyLoading.showInfo(
      message,
      duration: duration ?? const Duration(seconds: 2),
      maskType: EasyLoadingMaskType.black,
    );
  }

  /// Show toast message (appears at bottom)
  /// 
  /// [message] - Toast message to display
  /// [duration] - How long to show the toast
  static void showToast(
    String message, {
    Duration? duration,
    EasyLoadingToastPosition toastPosition = EasyLoadingToastPosition.bottom,
  }) {
    EasyLoading.showToast(
      message,
      duration: duration ?? const Duration(seconds: 2),
      toastPosition: toastPosition,
      maskType: EasyLoadingMaskType.none,
    );
  }

  /// Dismiss any currently shown loading
  static void dismiss() {
    EasyLoading.dismiss();
  }

  /// Check if EasyLoading is currently showing
  static bool get isShow => EasyLoading.isShow;

  /// Update theme configuration when theme changes
  /// Call this when the app theme is changed
  static void updateTheme() {
    final ITheme currentTheme = GetIt.I<MainAppCubit>().currentTheme;
    
    EasyLoading.instance
      ..progressColor = currentTheme.primaryColor
      ..indicatorColor = currentTheme.primaryColor
      ..textColor = currentTheme.primaryTextColor;
  }

  /// Configuration for specific loading scenarios
  
  /// Show loading for API calls
  static void showApiLoading({String? message}) {
    show(
      message: message ?? 'Loading data...',
      maskType: EasyLoadingMaskType.black,
    );
  }

  /// Show loading for file uploads with progress
  static void showUploadProgress(
    double progress, {
    String? fileName,
  }) {
    showProgress(
      progress,
      message: fileName != null 
        ? 'Uploading $fileName...\n${(progress * 100).toInt()}%'
        : 'Uploading...\n${(progress * 100).toInt()}%',
    );
  }

  /// Show loading for data synchronization
  static void showSyncLoading({String? message}) {
    show(
      message: message ?? 'Synchronizing data...',
      maskType: EasyLoadingMaskType.black,
    );
  }

  /// Show loading for saving operations
  static void showSaveLoading({String? message}) {
    show(
      message: message ?? 'Saving...',
      maskType: EasyLoadingMaskType.black,
    );
  }
}

/// Extension to provide easy access to loading functionality
extension LoadingExtension on Widget {
  /// Wrap widget with EasyLoading functionality
  Widget withLoading() {
    return FlutterEasyLoading(child: this);
  }
}
