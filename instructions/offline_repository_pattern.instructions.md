# Offline Repository Pattern Instructions

## Overview
This document provides instructions for implementing the offline repository pattern used in the data entry Flutter application.

## Pattern Structure

### 1. Online Repository
- Handles network-based data fetching through API calls
- **Automatically caches** fetched data to local database
- Uses GetIt for dependency injection

```dart
class FeatureOnlineRepository implements IFeatureRepository {
  BaseAPIClient get _apiClient => GetIt.I<ManagerEnvService>().apiClient;
  IDatabaseService get _databaseService => GetIt.I<IDatabaseService>();

  @override
  Future<DataModel?> fetchData() async {
    // 1. Fetch from API
    final response = await _apiClient.request<APIResponse<DataModel>>(
      option: ApiRoutesGenerated.endpoint(),
      create: (res) => APIResponse<DataModel>(
        originalResponse: res,
        decodedData: DataModel.fromJson(res.data ?? {}),
      ),
    );
    
    // 2. Cache to local database (automatic)
    if (response.decodedData != null) {
      await _databaseService.insertOrUpdateData(response.decodedData!);
    }
    
    return response.decodedData;
  }
}
```

### 2. Offline Repository
- Handles local data retrieval when network is unavailable
- Simple and clean implementation following abstract pattern
- Uses GetIt for dependency injection

```dart
class FeatureOfflineRepository implements IFeatureRepository {
  IDatabaseService get _databaseService => GetIt.I<IDatabaseService>();

  @override
  Future<DataModel?> fetchData() async {
    return await _databaseService.getData();
  }
}
```

### 3. Use Case
- **NO caching logic** - keep it simple and focused on business logic
- Just calls repository and returns result

```dart
class GetFeatureDataUseCase extends IGetFeatureDataUseCase with FeatureMixin {
  @override
  Future<DataModel?> call() async {
    return await featureRepository.fetchData();
  }
}
```

## Example Files Reference

- Online Repository: `features/meta_data/data/repositories/meta_data_online_repository.dart`
- Offline Repository: `features/meta_data/data/repositories/meta_data_offline_repository.dart`
- Use Case: `features/search_meter/domain/useCases/get_search_meter_use_case.dart`


For now, we just need to implement the online and offline repositories as shown above.


IMPORTANT:
- For the initial implementation, focus on the online repos only without caching, we will implement caching later.
- For the offline repos, just extends `OnlineRepository` for initial implementation, we will implement offline capabilities later.
- For the online repos, ignore caching logic for initial implementation, we will add it later.



