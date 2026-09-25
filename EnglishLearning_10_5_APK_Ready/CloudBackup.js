import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Text, Pressable, View, StyleSheet, ActivityIndicator, TextInput, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Stable snapshot keys: never rename the legacy storage keys as part of a backup.
export const BACKUP_KEYS = [
  '@technical_english_srs_v4',
  '@technical_english_progress_v4',
  '@technical_english_progress_v3',
  '@technical_english_speaking_history_v1',
  '@technical_english_listening_history_v1',
  '@technical_english_favorites_v1',
];
const FORMAT = 'english-learning-backup';
const VERSION = 1;
const MAX_BYTES = 5 * 1024 * 1024;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateBackup(snapshot) {
  if (!isObject(snapshot) || snapshot.format !== FORMAT || snapshot.schemaVersion !== VERSION || !isObject(snapshot.data)) {
    throw new Error('Đây không phải file sao lưu English Learning 10.5 hợp lệ.');
  }
  if (typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) {
    throw new Error('Bản sao lưu thiếu thời gian tạo hợp lệ.');
  }
  if (!Object.keys(snapshot.data).length || Object.keys(snapshot.data).some(k => !BACKUP_KEYS.includes(k))) {
    throw new Error('Bản sao lưu chứa khóa dữ liệu không hợp lệ.');
  }
  if (typeof snapshot.data['@technical_english_srs_v4'] !== 'string') {
    throw new Error('Bản sao lưu thiếu dữ liệu tiến độ học phiên bản hiện tại.');
  }
  for (const [key, raw] of Object.entries(snapshot.data)) {
    if (typeof raw !== 'string') throw new Error(`Giá trị không hợp lệ: ${key}`);
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`JSON bị hỏng: ${key}`); }
    if (key === '@technical_english_srs_v4' && (!isObject(parsed) || !Number.isInteger(parsed.currentDay) || parsed.currentDay < 1 || parsed.currentDay > 30 || !isObject(parsed.reviewData))) {
      throw new Error('Tiến độ học không đúng cấu trúc.');
    }
    if (key === '@technical_english_listening_history_v1' && !Array.isArray(parsed)) throw new Error('Lịch sử nghe phải là một danh sách.');
    if (key === '@technical_english_favorites_v1' && !Array.isArray(parsed)) throw new Error('Từ yêu thích phải là một danh sách.');
    if (key === '@technical_english_speaking_history_v1' && !isObject(parsed)) throw new Error('Lịch sử nói phải là một đối tượng.');
  }
  return snapshot;
}

export async function makeSnapshot() {
  const entries = await AsyncStorage.multiGet(BACKUP_KEYS);
  const data = Object.fromEntries(entries.filter(([, value]) => value !== null));
  return validateBackup({ format: FORMAT, schemaVersion: VERSION, createdAt: new Date().toISOString(), data });
}

export async function restoreSnapshot(snapshot) {
  const valid = validateBackup(snapshot);
  const keys = Object.keys(valid.data);
  const before = await AsyncStorage.multiGet(keys);
  try {
    await AsyncStorage.multiSet(keys.map(key => [key, valid.data[key]]));
  } catch (error) {
    // Best-effort local rollback if a write fails.
    try {
      await AsyncStorage.multiSet(before.filter(([, v]) => v !== null));
      await AsyncStorage.multiRemove(before.filter(([, v]) => v === null).map(([k]) => k));
    } catch (rollbackError) { /* User is instructed not to close app on failure. */ }
    throw new Error('Không thể khôi phục đầy đủ; hãy giữ file sao lưu và thử lại.');
  }
  return valid;
}

export default function CloudBackup({ onHome, onImported }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Chưa sao lưu trong lượt mở màn hình này.');
  const [candidate, setCandidate] = useState(null);
  const [candidateFile, setCandidateFile] = useState('JSON được dán');
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');

  async function exportFile() {
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = await makeSnapshot();
      setExportText(JSON.stringify(snapshot, null, 2));
      setStatus('Đã tạo JSON. Sao chép TOÀN BỘ nội dung ở ô bên dưới và dán vào một tài liệu Google Docs riêng tư trên Drive. Chưa coi là đã sao lưu cho đến khi xác nhận tài liệu có đủ nội dung.');
    } catch (e) { setStatus(`Lỗi tạo sao lưu: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function shareBackupText() {
    if (!exportText || busy) return;
    try {
      await Share.share({ message: exportText, title: 'English Learning backup JSON' });
      setStatus('Đã mở bảng chia sẻ văn bản. Nếu Google Drive không nhận văn bản trực tiếp, hãy sao chép từ ô JSON và dán vào Google Docs. Kiểm tra dữ liệu sau khi lưu.');
    } catch (e) { setStatus(`Không chia sẻ được: ${e.message}`); }
  }

  function checkImportText() {
    if (busy) return;
    setCandidate(null);
    try {
      if (!importText.trim()) throw new Error('Hãy dán toàn bộ JSON sao lưu vào ô bên dưới.');
      if (importText.length > MAX_BYTES) throw new Error('Dữ liệu vượt 5 MB.');
      const snapshot = validateBackup(JSON.parse(importText.trim()));
      setCandidate(snapshot);
      const srs = JSON.parse(snapshot.data['@technical_english_srs_v4']);
      setStatus(`Đã kiểm tra bản sao lưu · tạo ${new Date(snapshot.createdAt).toLocaleString()} · Day ${srs.currentDay}/30. Chưa ghi đè dữ liệu. Nhấn xác nhận khôi phục nếu muốn tiếp tục.`);
    } catch (e) { setStatus(`JSON không hợp lệ: ${e.message}`); }
  }

  function confirmImport() {
    if (!candidate || busy) return;
    Alert.alert('Xác nhận khôi phục', `File: ${candidateFile}\nDữ liệu hiện có thuộc các mục trong file sẽ được THAY THẾ. Bạn nên xuất bản sao lưu hiện tại lên Drive trước khi tiếp tục.`, [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Khôi phục', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          const restored = await restoreSnapshot(candidate);
          setCandidate(null);
          setStatus('Khôi phục hoàn tất. Đang làm mới dữ liệu trong ứng dụng…');
          onImported(restored);
        } catch (e) { setStatus(`Lỗi khôi phục: ${e.message}`); }
        finally { setBusy(false); }
      } },
    ]);
  }

  return <SafeAreaView style={s.root}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Pressable onPress={onHome}><Text style={s.back}>← Home</Text></Pressable>
    <Text style={s.title}>☁️ Cloud Backup 10.5 – Bản tương thích Snack</Text>
    <Text style={s.note}>Chế độ sao lưu JSON bằng cách sao chép/dán, không sử dụng expo-file-system, expo-sharing hoặc expo-document-picker. Dữ liệu vẫn nằm trong AsyncStorage cho đến khi bạn xác nhận khôi phục.</Text>
    <View style={s.card}>
      <Text style={s.heading}>1. Sao lưu lên Google Drive</Text>
      <Pressable disabled={busy} style={s.button} onPress={exportFile}><Text style={s.buttonText}>Tạo nội dung sao lưu JSON</Text></Pressable>
      {!!exportText && <>
        <Text style={s.note}>Nhấn giữ trong ô → Chọn tất cả → Sao chép. Mở Google Docs bằng tài khoản của bạn, tạo tài liệu riêng tư, dán toàn bộ JSON và đặt tên có ngày sao lưu. Kiểm tra đã lưu xong trước khi xóa dữ liệu điện thoại.</Text>
        <TextInput value={exportText} editable={false} multiline selectTextOnFocus={false} style={s.jsonBox} accessibilityLabel="Nội dung sao lưu JSON để sao chép" />
        <Pressable disabled={busy} style={s.button} onPress={shareBackupText}><Text style={s.buttonText}>Chia sẻ văn bản (nếu thiết bị hỗ trợ)</Text></Pressable>
      </>}
    </View>
    <View style={s.card}>
      <Text style={s.heading}>2. Khôi phục từ bản sao lưu</Text>
      <Text style={s.note}>Mở tài liệu sao lưu trên Google Drive/Docs, sao chép toàn bộ JSON rồi dán vào ô dưới. Sau đó kiểm tra và xác nhận. Khôi phục sẽ thay thế các mục trùng khóa, không tự gộp hai thiết bị.</Text>
      <TextInput value={importText} onChangeText={text => { setImportText(text); setCandidate(null); }} multiline placeholder="Dán toàn bộ JSON sao lưu vào đây" style={s.jsonBox} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Dán JSON để khôi phục" />
      <Pressable disabled={busy} style={s.button} onPress={checkImportText}><Text style={s.buttonText}>Kiểm tra dữ liệu trước khi khôi phục</Text></Pressable>
      {!!candidate && <Pressable disabled={busy} style={s.danger} onPress={confirmImport}><Text style={s.buttonText}>Xác nhận thay thế dữ liệu từ bản sao lưu</Text></Pressable>}
    </View>
    {busy && <ActivityIndicator/>}<Text style={s.status}>{status}</Text>
    <Text style={s.note}>Không lưu bản ghi âm tạm và không có đồng bộ tự động. Trước khi khôi phục, hãy sao lưu dữ liệu hiện tại. Dùng tài liệu Google Docs riêng tư, không chia sẻ công khai vì có thông tin học tập cá nhân.</Text>
  </ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({root:{flex:1,backgroundColor:'#F4F7FC'},page:{padding:18,paddingBottom:45,gap:14},back:{color:'#2349A8',fontSize:16,fontWeight:'700'},title:{fontSize:25,fontWeight:'800',color:'#163269'},note:{color:'#52617A',lineHeight:21},card:{backgroundColor:'white',borderRadius:16,padding:17,gap:12},heading:{fontSize:17,fontWeight:'800',color:'#2349A8'},button:{backgroundColor:'#2349A8',padding:14,borderRadius:11,alignItems:'center'},danger:{backgroundColor:'#B83B40',padding:14,borderRadius:11,alignItems:'center'},buttonText:{color:'white',fontWeight:'700'},status:{backgroundColor:'#E4EFFF',padding:13,borderRadius:12,color:'#17336D',lineHeight:20},jsonBox:{minHeight:160,maxHeight:300,borderWidth:1,borderColor:'#BCC8DC',backgroundColor:'#F7F9FC',borderRadius:9,padding:11,color:'#17336D',fontSize:12,textAlignVertical:'top'}});
