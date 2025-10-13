import 'dart:io';
import 'package:extended_image/extended_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

enum ImageType { network, file, asset }

extension ImageExtension on String {
  /// Returns an [ExtendedImage] or [SvgPicture] widget that automatically detects image type.
  /// Supports network URLs (http/https), local file paths, and asset paths.
  /// [width], [height], [fit], and [color] are optional.
  /// Shows a placeholder or error widget on failure.
  Widget toExtendedImage({
    double? width,
    double? height,
    BoxFit fit = BoxFit.cover,
    Color? color,
    Widget? errorWidget,
    Widget? loadingWidget,
    Color? loadingProgressColor,
    bool showLoadingProgress = false,
  }) {
    final imageType = _detectImageType();
    final isSvg = endsWith('.svg');

    if (isSvg) {
      switch (imageType) {
        case ImageType.network:
          return SvgPicture.network(
            this,
            width: width,
            height: height,
            fit: fit,
            color: color,
            placeholderBuilder:
                (context) =>
                    loadingWidget ??
                    const Center(child: CircularProgressIndicator()),
            errorBuilder:
                (context, error, stackTrace) =>
                    errorWidget ?? const Icon(Icons.broken_image),
          );
        case ImageType.file:
          return SvgPicture.file(
            File(this),
            width: width,
            height: height,
            fit: fit,
            color: color,
            placeholderBuilder:
                (context) =>
                    loadingWidget ??
                    const Center(child: CircularProgressIndicator()),
          );
        case ImageType.asset:
          return SvgPicture.asset(
            this,
            width: width,
            height: height,
            fit: fit,
            color: color,
            placeholderBuilder:
                (context) =>
                    loadingWidget ??
                    const Center(child: CircularProgressIndicator()),
          );
      }
    } else {
      switch (imageType) {
        case ImageType.network:
          return ExtendedImage.network(
            this,
            handleLoadingProgress: true,
            width: width,
            height: height,
            fit: fit,
            color: color,
            loadStateChanged: (state) {
              switch (state.extendedImageLoadState) {
                case LoadState.failed:
                  return errorWidget ?? const Icon(Icons.broken_image);
                case LoadState.loading:
                  if (showLoadingProgress) {
                    if (state.loadingProgress != null) {
                      final progress = state.loadingProgress!;
                      final progressValue =
                          progress.expectedTotalBytes != null
                              ? progress.cumulativeBytesLoaded /
                                  progress.expectedTotalBytes!
                              : null;

                      return Center(
                        child: CircularProgressIndicator(
                          value: progressValue,
                          color: loadingProgressColor,
                        ),
                      );
                    } else {
                      // Show indeterminate progress when loadingProgress is null
                      return Center(
                        child: CircularProgressIndicator(
                          color: loadingProgressColor,
                        ),
                      );
                    }
                  } else {
                    return loadingWidget ??
                        const Center(child: CircularProgressIndicator());
                  }
                case LoadState.completed:
                  return null;
              }
            },
          );
        case ImageType.file:
          return ExtendedImage.file(
            File(this),
            width: width,
            height: height,
            fit: fit,
            color: color,
            enableLoadState: true,
            loadStateChanged: (state) {
              switch (state.extendedImageLoadState) {
                case LoadState.failed:
                  return errorWidget ?? const Icon(Icons.broken_image);
                case LoadState.loading:
                  if (showLoadingProgress) {
                    if (state.loadingProgress != null) {
                      final progress = state.loadingProgress!;
                      final progressValue =
                          progress.expectedTotalBytes != null
                              ? progress.cumulativeBytesLoaded /
                                  progress.expectedTotalBytes!
                              : null;

                      return loadingWidget ??
                          Center(
                            child: CircularProgressIndicator(
                              value: progressValue,
                              color: loadingProgressColor,
                            ),
                          );
                    } else {
                      // Show indeterminate progress when loadingProgress is null
                      return loadingWidget ??
                          Center(
                            child: CircularProgressIndicator(
                              color: loadingProgressColor,
                            ),
                          );
                    }
                  } else {
                    return loadingWidget ??
                        const Center(child: CircularProgressIndicator());
                  }
                case LoadState.completed:
                  return null;
              }
            },
          );
        case ImageType.asset:
          return ExtendedImage.asset(
            this,
            width: width,
            height: height,
            fit: fit,
            color: color,
            enableLoadState: true,
            loadStateChanged: (state) {
              switch (state.extendedImageLoadState) {
                case LoadState.failed:
                  return errorWidget ?? const Icon(Icons.broken_image);
                case LoadState.loading:
                  if (showLoadingProgress) {
                    if (state.loadingProgress != null) {
                      final progress = state.loadingProgress!;
                      final progressValue =
                          progress.expectedTotalBytes != null
                              ? progress.cumulativeBytesLoaded /
                                  progress.expectedTotalBytes!
                              : null;

                      return loadingWidget ??
                          Center(
                            child: CircularProgressIndicator(
                              value: progressValue,
                              color: loadingProgressColor,
                            ),
                          );
                    } else {
                      // Show indeterminate progress when loadingProgress is null
                      return loadingWidget ??
                          Center(
                            child: CircularProgressIndicator(
                              color: loadingProgressColor,
                            ),
                          );
                    }
                  } else {
                    return loadingWidget ??
                        const Center(child: CircularProgressIndicator());
                  }
                case LoadState.completed:
                  return null;
              }
            },
          );
      }
    }
  }

  /// Detects the image type based on the string content
  ImageType _detectImageType() {
    // Check if it's a network URL
    if (startsWith('http://') || startsWith('https://')) {
      return ImageType.network;
    }

    // Check if it's a local file path (absolute path)
    if (startsWith('/') ||
        (Platform.isWindows && length > 1 && this[1] == ':') ||
        File(this).existsSync()) {
      return ImageType.file;
    }

    // Default to asset
    return ImageType.asset;
  }
}

extension ImageUrlExtension on String {
  /// Extracts the image filename from a URL and returns the asset path.
  /// Similar to iOS implementation that extracts filename from ImageUrl.
  /// Returns the default image if extraction fails or image doesn't exist.
  String toAssetImageName({String defaultImage = 'TreeElectricity_m'}) {
    try {
      // Extract filename from URL
      final uri = Uri.parse(this);
      final pathSegments = uri.pathSegments;

      if (pathSegments.isEmpty) {
        return 'assets/images/$defaultImage.png';
      }

      // Get the last segment (filename)
      String filename = pathSegments.last;

      // Remove the .png extension if present (like iOS does)
      if (filename.endsWith('.png')) {
        filename = filename.substring(0, filename.length - 4);
      }

      // Return the asset path
      return 'assets/images/$filename.png';
    } catch (e) {
      // Return default image if URL parsing fails
      return 'assets/images/$defaultImage.png';
    }
  }

  /// Checks if the asset image exists in the bundle.
  /// This is a simplified version - in a real app you might want to maintain
  /// a list of available assets or check them dynamically.
  bool get isAssetAvailable {
    final assetName = toAssetImageName();
    // Available meter images based on actual assets folder
    final availableImages = [
      'TreeBatteryOAT_m.png',
      'TreeElectricity_m.png',
      'TreeGas_m.png',
      'TreeHotWater_m.png',
      'TreeProduction_m.png',
      'TreeVirtualMeter_m.png',
      'TreeWaste_m.png',
      'TreeWater_m.png',
      'TreeDynamatWorld.png',
      'TreeSite.png',
      // Default fallback image (using TreeElectricity_m as default if ImgTypeDefault doesn't exist)
      'ImgTypeDefault.png',
    ];

    return availableImages.any((img) => assetName.endsWith(img));
  }
}
