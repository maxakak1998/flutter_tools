---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency for using  CustomCubit


1. **BaseCubitState State**
   -Always extend BaseCubitState located in `lib/commons/base_cubit/base_cubit.dart` for all states.
   - BaseCubitState includes:
     - `isLoading`: Indicates if the specific state is loading. When using it, you have also check which state is loading, not for all states. So, be specific about the state you are checking, but it's rarely used.
     - `id`: Contains the data for the state, you should use `DateTime.now().microsecondsSinceEpoch.toString()` 
     - `eventState`: Holds the current event state.
      - `EventState.loading`: Indicates the state is loading.
      - `EventState.success`: Indicates the state has successfully loaded.
      - `EventState.error`: Indicates the state has encountered an error.
     - `error`: Holds any error message.
     - `isLoadMore`: If this state is in the list view, it indicates if more data is being loaded.
     - `isRefresh`: If this state is in the list view, it indicates if the data is being refreshed.

2. **CustomCubit Widget** This a helpful cubit should use in whole app, only working with `BaseCubitState`
 Example:
 ```dart CustomCubit(
                              bloc: _signUpCubit,
                              onSucceed: (state) async {
                                if (state is UserVerifyState) {
                                   showSucceed(message: "Send OTP successfully");

                                }
                              },
                              onError: (state) async {
                                if (state is UserVerifyState) {
                                 showError(
                                      message: AppUtils.getErrorTranslation(
                                          context, state.error));
                                }
                              },
                              onLoading: (state) => false,
                              builder: (context, state, isLoading) =>
                                  SignUpForm(
                                    cubit: _signUpCubit,
                                  ),
              )```

3. **How to emit State in Cubit**

```dart
  void verifyAccount({required VerifyAccountParams params}) async {
    final id = DateTime.now().microsecondsSinceEpoch.toString();
    try {
      emit(UserVerifyState(id: id));
      _verifyAccountResponse = await _authRepos.verifyAccount(params);
      emit(UserVerifyState(
          id: id,
          state: _verifyAccountResponse != null
              ? EventState.succeed
              : EventState.error));
    } catch (e) {
      emit(UserVerifyState(error: e, id: id, state: EventState.error));
    }
  }
```

4. **How to inject a cubit**

```dart
 Make sure that BlocConsumer<MainSetupCubit, BaseCubitState> is under your MultiProvider/Provider<MainSetupCubit>.
  This usually happens when you are creating a provider and trying to read it immediately.

  For example, instead of:
```dart
  Widget build(BuildContext context) {
    return Provider<Example>(
      create: (_) => Example(),
      // Will throw a ProviderNotFoundError, because `context` is associated
      // to the widget that is the parent of `Provider<Example>`
      child: Text(context.watch<Example>().toString()),
    );
  }
  ```

  consider using `builder` like so:

  ```
  Widget build(BuildContext context) {
    return Provider<Example>(
      create: (_) => Example(),
      // we use `builder` to obtain a new `BuildContext` that has access to the provider
      builder: (context, child) {
        // No longer throws
        return Text(context.watch<Example>().toString());
      }
    );
  }```
  ```


** Remember:**
- Always use `BaseCubitState` for all states.
- Always use `CustomCubit` in the Presentation layer.
- Always use `DateTime.now().microsecondsSinceEpoch.toString()` for the `id` field in the state.
- The `id` field is used to identify the state and should be the same for each lifecycle of the state
- Pattern: emit(loading) -> Show loading → await useCase → emit(success/error) -> Hide loading
** Do not:**
- Do not check loading without specific state.
- Alaways give the `id` field in the state

 
 Very important, you have to follow this pattern for all states in the app.:
- Pattern: emit(loading) -> Show loading (in Presentation layer using CommonLoadingWidget) → await useCase → emit(success/error) -> Hide loading
