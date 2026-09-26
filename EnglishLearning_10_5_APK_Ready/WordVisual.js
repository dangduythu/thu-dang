import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

const PICTURES = [
  [/schedule|plan|deadline|timeline|shift|lịch|kế hoạch|ca làm/, '🗓️', 'Lập kế hoạch'],
  [/quality|inspection|audit|defect|kiểm soát|chất lượng|kiểm tra/, '🔍', 'Kiểm tra chất lượng'],
  [/production|manufactur|factory|assembly|sản xuất|nhà máy|lắp ráp/, '🏭', 'Sản xuất'],
  [/machine|equipment|tool|maintenance|máy móc|thiết bị|bảo trì/, '⚙️', 'Máy móc và thiết bị'],
  [/safety|hazard|risk|protect|an toàn|nguy cơ|rủi ro/, '🦺', 'An toàn lao động'],
  [/warehouse|inventory|stock|storage|kho|tồn kho/, '📦', 'Kho hàng'],
  [/shipping|delivery|transport|logistics|giao hàng|vận chuyển/, '🚚', 'Vận chuyển'],
  [/data|report|chart|graph|metric|báo cáo|biểu đồ|số liệu/, '📊', 'Dữ liệu và báo cáo'],
  [/team|staff|employee|meeting|nhân viên|đội nhóm|cuộc họp/, '👥', 'Làm việc nhóm'],
  [/improve|idea|innov|solution|cải tiến|ý tưởng|giải pháp/, '💡', 'Ý tưởng cải tiến'],
  [/customer|client|order|khách hàng|đơn hàng/, '🤝', 'Khách hàng'],
  [/cost|budget|profit|price|chi phí|ngân sách/, '💰', 'Chi phí'],
  [/training|learn|skill|học|đào tạo|kỹ năng/, '📚', 'Đào tạo'],
  [/computer|software|system|digital|máy tính|phần mềm|hệ thống/, '💻', 'Công nghệ'],
  [/electric|power|energy|điện|năng lượng/, '⚡', 'Năng lượng'],
  [/measure|dimension|length|size|đo lường|kích thước/, '📏', 'Đo lường'],
];
function illustration(word, meaning, topic) {
  const text = `${word || ''} ${meaning || ''} ${topic || ''}`.toLowerCase();
  const hit = PICTURES.find(([pattern]) => pattern.test(text));
  return hit ? { icon: hit[1], label: hit[2] } : { icon: '🧩', label: 'Gợi nhớ từ vựng' };
}
function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}
export default function WordVisual({ word, meaning, topic, compact = false }) {
  const [photo, setPhoto] = useState(null);
  const [state, setState] = useState('idle');
  const visual = illustration(word, meaning, topic);
  async function findPhoto() {
    if (state === 'loading') return;
    if (photo) { setPhoto(null); setState('idle'); return; }
    setState('loading');
    try {
      const query = String(word || '').trim().slice(0, 70);
      if (!query) throw new Error('no-word');
      const url = 'https://commons.wikimedia.org/w/api.php?' + [
        'action=query', 'generator=search', 'gsrnamespace=6', 'gsrlimit=8',
        `gsrsearch=${encodeURIComponent(query + ' filetype:bitmap')}`,
        'prop=imageinfo', 'iiprop=url%7Cextmetadata', 'iiurlwidth=560', 'format=json', 'origin=*',
      ].join('&');
      const response = await fetch(url);
      if (!response.ok) throw new Error('network');
      const payload = await response.json();
      const pages = Object.values(payload.query?.pages || {});
      const candidate = pages.map(p => ({ title: p.title, info: p.imageinfo?.[0] }))
        .find(p => p.info && /^https:\/\//.test(p.info.thumburl || p.info.url || '') &&
          /\.(jpe?g|png|webp)(\?|$)/i.test(p.info.url || '') &&
          (p.info.thumburl || p.info.url || '').includes('wikimedia.org'));
      if (!candidate) throw new Error('not-found');
      setPhoto({ uri: candidate.info.thumburl || candidate.info.url,
        credit: plainText(candidate.info.extmetadata?.Artist?.value) || 'Wikimedia Commons',
        license: plainText(candidate.info.extmetadata?.LicenseShortName?.value),
        title: candidate.title,
        page: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(candidate.title.replace(/ /g, '_')) });
      setState('ready');
    } catch (err) { setState('unavailable'); }
  }
  return <View style={[s.root, compact && s.compact]}>
    {photo ? <Image source={{ uri: photo.uri }} style={s.photo} resizeMode="contain" /> :
      <View style={s.illustration}><View style={s.orb}><Text style={s.emoji}>{visual.icon}</Text></View><Text style={s.visualLabel}>{visual.label}</Text></View>}
    <Text style={s.note}>{photo ? 'Ảnh tham khảo – hãy đối chiếu với nghĩa của từ.' : 'Hình gợi nhớ (có sẵn khi không có mạng)'}</Text>
    {photo && <Pressable onPress={() => Linking.openURL(photo.page).catch(() => {})} accessibilityRole="link"><Text style={s.credit} numberOfLines={2}>Nguồn/giấy phép: {photo.credit} · {photo.license || 'Wikimedia Commons'} ↗</Text></Pressable>}
    <Pressable style={s.button} onPress={findPhoto} disabled={state === 'loading'} accessibilityRole="button" accessibilityLabel={photo ? 'Ẩn ảnh tham khảo' : 'Tìm ảnh thực tế minh họa'}>
      {state === 'loading' ? <ActivityIndicator color="#2349A8" size="small" /> : <Text style={s.buttonText}>{photo ? 'Ẩn ảnh thực tế' : '🖼️ Tìm ảnh thực tế (cần mạng)'}</Text>}
    </Pressable>
    {state === 'unavailable' && <Text style={s.credit}>Chưa tìm được ảnh phù hợp; hình gợi nhớ vẫn hiển thị.</Text>}
  </View>;
}
const s = StyleSheet.create({
  root: { width: '100%', backgroundColor: '#EEF4FF', borderRadius: 16, padding: 12, marginVertical: 12, alignItems: 'center' },
  compact: { marginVertical: 8 },
  illustration: { alignItems: 'center', justifyContent: 'center', minHeight: 142, width: '100%' },
  orb: { width: 100, height: 100, backgroundColor: '#D5E5FF', borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 57 }, visualLabel: { color: '#23477C', fontWeight: '700', marginTop: 8 },
  photo: { width: '100%', height: 190, borderRadius: 10, backgroundColor: '#E8EEF8' },
  note: { color: '#66758A', fontSize: 11, marginTop: 5, textAlign: 'center' },
  credit: { color: '#66758A', fontSize: 10, textAlign: 'center', marginTop: 4 },
  button: { minHeight: 44, marginTop: 9, paddingHorizontal: 15, backgroundColor: '#FFFFFF', borderRadius: 10, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },
  buttonText: { color: '#2349A8', fontWeight: '700', textAlign: 'center' },
});
