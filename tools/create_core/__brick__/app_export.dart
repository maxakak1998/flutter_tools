export "package:flutter_bloc/flutter_bloc.dart";
export 'dart:async';
export 'package:flutter/material.dart' hide MetaData;
export 'package:{{project_name}}/commons/base_cubit/base_cubit_state.dart';
export "package:get_it/get_it.dart";
export 'package:easy_localization/easy_localization.dart' hide TextDirection;
export 'package:firebase_core/firebase_core.dart';
export 'package:{{project_name}}/features/main_app/presentation/screen/main_app_screen.dart';
export 'package:{{project_name}}/features/main_app/presentation/cubit/main_app_cubit.dart';
export 'core/localization/supported_locales_enum.dart';
export 'package:{{project_name}}/core/services/manager_service/manager_env_service.dart';
export 'package:{{project_name}}/commons/base_cubit/base_cubit.dart';
export 'package:device_preview/device_preview.dart'
    hide DeviceType, basicLocaleListResolution;

export 'package:{{project_name}}/core/localization/locale_service.dart';
export 'package:{{project_name}}/features/main_app/domain/useCases/change_theme_use_case.dart';
export 'package:flutter_screenutil/flutter_screenutil.dart';
export 'package:{{project_name}}/core/theme/base_theme.dart';
export '../../../../core/theme/normal_theme.dart';
export 'package:go_router/go_router.dart';
export 'package:{{project_name}}/core/routers/routers.dart';
export 'package:{{project_name}}/core/services/secure_storage/base_secure_storage.dart';
export 'package:{{project_name}}/core/services/secure_storage/secure_storage.dart';
export 'package:{{project_name}}/features/init/domain/useCases/navigation_redirect_use_case.dart';
export 'package:{{project_name}}/features/main_app/presentation/mixins/main_app_mixin.dart';
export 'package:{{project_name}}/commons/widgets/common_loading_widget.dart';
export 'package:url_launcher/url_launcher.dart';
export 'package:package_info_plus/package_info_plus.dart';
