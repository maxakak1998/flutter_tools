import 'package:extended_image/extended_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

extension ImageExtension on String {
  /// Returns an [ExtendedImage] or [SvgPicture] widget for the given asset or network path.
  /// If [isAsset] is true, loads from assets; otherwise, loads from network.
  /// [width], [height], [fit], and [color] are optional.
  /// Shows a placeholder or error widget on failure.
  Widget toExtendedImage({
    bool isAsset = true,
    double? width,
    double? height,
    BoxFit fit = BoxFit.cover,
    Color? color,
    Widget? errorWidget,
    Widget? loadingWidget,
  }) {
    if (endsWith('.svg')) {
      if (isAsset) {
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
      } else {
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
      }
    } else {
      if (isAsset) {
        return ExtendedImage.asset(
          this,
          width: width,
          height: height,
          fit: fit,
          color: color,
          loadStateChanged: (state) {
            switch (state.extendedImageLoadState) {
              case LoadState.failed:
                return errorWidget ?? const Icon(Icons.broken_image);
              case LoadState.loading:
                return loadingWidget ??
                    const Center(child: CircularProgressIndicator());
              case LoadState.completed:
                return null;
            }
          },
        );
      } else {
        return ExtendedImage.network(
          this,
          width: width,
          height: height,
          fit: fit,
          color: color,
          loadStateChanged: (state) {
            switch (state.extendedImageLoadState) {
              case LoadState.failed:
                return errorWidget ?? const Icon(Icons.broken_image);
              case LoadState.loading:
                return loadingWidget ??
                    const Center(child: CircularProgressIndicator());
              case LoadState.completed:
                return null;
            }
          },
        );
      }
    }
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
