---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency for using API
1. APIClient
   - Use the `APIClient` class located in `lib/core/api/api_client.dart` for all API requests.
   - Always get the `APIClient` instance from the `getIt` service locator 
   ```dart
     final APIClient _apiClient =GetIt.I<ManagerEnvService>().apiClient;
   ```
   - Do not create a new instance of `APIClient` directly.
   - The proper structure for single-response API calls is:
   ```dart
    final response = await _apiClient.request<APIResponse<MetaData>>(
      option: MainRouteApiRoutesGenerated.metaData(),
      create: (res) => APIResponse<MetaData>(originalResponse: res,decodedData: MetaData()),
    );
    final data = response.decodedData;
    return data;
   ```
   - The proper structure for single-response API calls is:
   ```dart
    final APIListResponse<MetaData> response = await _apiClient.request< APIListResponse<MetaData>>(
      option: MainRouteApiRoutesGenerated.metaData(),
      create: (res) => APIListResponse<MetaData>(originalResponse: res,decodedData: MetaData()),
    );
    final data = response.decodedList;
    return data;
   ```
   - The model for each API response should be generated from this steps:
    1. Import the response model to the api_routes.json
    2. Run `make gen_api` to generate the API routes and models.
    3. Use that model in the API call as the `create` parameter in the `decodedData` method.
    4. Return the decoded data(generated model) from the API call.

