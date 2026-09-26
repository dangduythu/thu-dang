import { Alert, BackHandler, Platform } from 'react-native';

// Android's physical/system-edge Back uses the same handler as the app's back button.
export function confirmExit() {
  Alert.alert('Tiếp tục học tiếng Anh?', 'Bạn muốn ở lại học hay thoát ứng dụng?', [
    { text: 'Ở lại học', style: 'cancel' },
    { text: 'Thoát ứng dụng', style: 'destructive', onPress: () => BackHandler.exitApp() },
  ], { cancelable: true });
}

export function installAndroidBack(handler) {
  if (Platform.OS !== 'android') return () => {};
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    handler();
    return true;
  });
  return () => subscription.remove();
}
