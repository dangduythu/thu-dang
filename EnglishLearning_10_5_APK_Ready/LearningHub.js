import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import WordVisual from './WordVisual';

// New keys only: original V7 SRS, speaking and listening keys remain untouched.
const FAVORITES_KEY = '@technical_english_favorites_v1';
const LISTENING_KEY = '@technical_english_listening_history_v1';
const normalize = value => String(value || '').trim().toLocaleLowerCase();
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function latestMisses(history) {
  const outcomes = new Map();
  // History is newest first. Within a quiz, the last answer for a word takes precedence.
  for (const entry of history) {
    const answers = Array.isArray(entry.answers) ? [...entry.answers].reverse() : [];
    if (answers.length) {
      for (const ans of answers) if (ans && ans.id != null && !outcomes.has(String(ans.id))) outcomes.set(String(ans.id), !ans.correct);
    } else {
      for (const item of (entry.mistakes || [])) if (item && item.id != null && !outcomes.has(String(item.id))) outcomes.set(String(item.id), true);
    }
  }
  return outcomes;
}

export default function LearningHub({ vocabulary, currentDay, reviewData, speakingHistory, onHome, onDay, onLearn, onSpeaking, onListening, onTest, onSrsReview }) {
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [accent, setAccent] = useState('en-US');
  const [visualWordId, setVisualWordId] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [savedFav, savedListening] = await Promise.all([
          AsyncStorage.getItem(FAVORITES_KEY), AsyncStorage.getItem(LISTENING_KEY),
        ]);
        if (!live) return;
        const parsedFav = savedFav ? JSON.parse(savedFav) : [];
        const parsedHistory = savedListening ? JSON.parse(savedListening) : [];
        setFavorites(Array.isArray(parsedFav) ? parsedFav.map(String) : []);
        setHistory(Array.isArray(parsedHistory) ? parsedHistory : []);
      } catch (e) {
        if (live) setError('Không tải được dữ liệu bổ sung. Dữ liệu học cũ không bị xóa.');
      } finally { if (live) setReady(true); }
    })();
    return () => { live = false; Speech.stop().catch(() => {}); };
  }, []);

  async function toggleFavorite(id) {
    if (!ready) return;
    const key = String(id);
    const updated = favorites.includes(key) ? favorites.filter(x => x !== key) : [...favorites, key];
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
      setFavorites(updated);
      setError('');
    } catch (e) { setError('Không lưu được mục yêu thích. Hãy kiểm tra dung lượng bộ nhớ.'); }
  }
  function play(word, slow = false) {
    Speech.stop().then(() => Speech.speak(word, { language: accent, rate: slow ? 0.7 : 0.93 })).catch(() => setError('Không thể phát âm thanh. Kiểm tra âm lượng.'));
  }

  const misses = useMemo(() => latestMisses(history), [history]);
  const weak = useMemo(() => vocabulary.filter(item => {
    const srs = reviewData[item.id];
    return (srs && (srs.lastRating === 'again' || srs.lastRating === 'hard' || srs.nextReview <= Date.now())) || misses.get(String(item.id)) === true;
  }), [vocabulary, reviewData, misses]);
  const learned = vocabulary.filter(item => Boolean(reviewData[item.id])).length;
  const due = vocabulary.filter(item => reviewData[item.id] && reviewData[item.id].nextReview <= Date.now()).length;
  const today = dayKey();
  const todayQuizzes = history.filter(item => item.date === today);
  const todaySpeaking = Object.values(speakingHistory[today] || {}).reduce((sum, lessons) => sum + Object.keys(lessons || {}).length, 0);
  const searched = vocabulary.filter(item => (!onlyFavorites || favorites.includes(String(item.id))) &&
    (normalize(item.word).includes(normalize(search)) || normalize(item.meaning).includes(normalize(search)) || String(item.day) === search.trim())).slice(0, 80);
  const weakIds = weak.slice(0, 20).map(item => item.id);
  const testPool = vocabulary.filter(item => Boolean(reviewData[item.id]));
  const testWords = testPool.length >= 4 ? testPool : vocabulary.filter(item => item.day === currentDay);
  const tabs = [['overview','Tổng quan'],['dictionary','Tra từ'],['smart','Ôn từ yếu'],['test','Kiểm tra']];

  return <SafeAreaView style={s.root}>
    <View style={s.header}><Pressable onPress={onHome} style={{minHeight:48,justifyContent:'center',paddingHorizontal:8}} hitSlop={8}><Text style={s.back}>← Home</Text></Pressable><Text style={s.headerTitle}>ENGLISH LEARNING 10.0</Text></View>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>My Learning</Text><Text style={s.muted}>Day {currentDay}/30 · English for Manufacturing & Engineering</Text>
      <View style={s.tabRow}>{tabs.map(([id,label]) => <Pressable key={id} onPress={() => setTab(id)} style={[s.tab,tab===id&&s.activeTab]}><Text style={[s.tabLabel,tab===id&&s.activeTabText]}>{label}</Text></Pressable>)}</View>
      {!ready && <ActivityIndicator />}{Boolean(error) && <Text style={s.error}>{error}</Text>}
      {tab==='overview' && <>
        <View style={s.hero}><Text style={s.heroSub}>YOUR LEARNING JOURNEY</Text><Text style={s.heroTitle}>Day {currentDay} / 30</Text><Text style={s.heroSub}>{learned}/{vocabulary.length} từ đã học · {due} từ đến hạn ôn</Text><View style={s.track}><View style={[s.fill,{width:`${vocabulary.length ? learned/vocabulary.length*100 : 0}%`}]} /></View><Pressable onPress={onLearn} style={s.heroAction}><Text style={s.heroActionText}>▶ Tiếp tục bài học</Text></Pressable></View>
        <View style={s.grid}><Tile icon="📚" label="Vocabulary" caption="Bài hiện tại" onPress={onLearn}/><Tile icon="🎧" label="Listening" caption="Nghe và chọn nghĩa" onPress={onListening}/><Tile icon="🎤" label="Speaking" caption="Ghi âm và nghe lại" onPress={onSpeaking}/><Tile icon="🧠" label="Smart Review" caption={`${weak.length} từ cần chú ý`} onPress={()=>setTab('smart')}/></View>
        <View style={s.card}><Text style={s.section}>Today's Progress</Text><Text>🎧 {todayQuizzes.length} bài nghe · 🎤 {todaySpeaking} từ-ngày đã ghi âm</Text><Text style={s.muted}>Mục tiêu gợi ý: 1 bài nghe và luyện 5 từ mỗi ngày.</Text></View>
        <Pressable style={s.secondary} onPress={onDay}><Text style={s.secondaryText}>Xem chương trình 30 ngày →</Text></Pressable>
      </>}
      {tab==='dictionary' && <>
        <Text style={s.section}>Tra từ và lưu yêu thích</Text><TextInput style={s.input} placeholder="Tìm tiếng Anh, nghĩa tiếng Việt hoặc số ngày..." value={search} onChangeText={setSearch} autoCapitalize="none" />
        <Pressable style={s.secondary} onPress={()=>setOnlyFavorites(x=>!x)}><Text style={s.secondaryText}>{onlyFavorites?'★ Đang xem từ yêu thích':'☆ Chỉ xem từ yêu thích'} · {favorites.length} từ</Text></Pressable>
        <View style={s.accentRow}>{['en-US','en-GB'].map(code=><Pressable key={code} style={[s.accent,accent===code&&s.accentActive]} onPress={()=>setAccent(code)}><Text>{code==='en-US'?'🇺🇸 Anh–Mỹ':'🇬🇧 Anh–Anh'}</Text></Pressable>)}</View>
        <Text style={s.muted}>Hiển thị tối đa 80 kết quả mỗi lần tìm.</Text>
        {searched.map(item=><React.Fragment key={item.id}><View style={s.wordRow}><View style={{flex:1}}><Text style={s.word}>{item.word}</Text><Text>{item.meaning}</Text><Text style={s.muted}>Day {item.day} · {item.topic}</Text></View><Pressable onPress={()=>setVisualWordId(x=>x===item.id?null:item.id)} style={s.mini}><Text>🖼️</Text></Pressable><Pressable onPress={()=>play(item.word)} style={s.mini}><Text>🔊</Text></Pressable><Pressable onPress={()=>toggleFavorite(item.id)} style={s.mini}><Text>{favorites.includes(String(item.id))?'★':'☆'}</Text></Pressable></View>{visualWordId===item.id && <WordVisual word={item.word} meaning={item.meaning} topic={item.topic} compact />}</React.Fragment>)}
        {!searched.length && <Text style={s.muted}>Không tìm thấy từ phù hợp.</Text>}
      </>}
      {tab==='smart' && <>
        <Text style={s.section}>Ôn tập theo kết quả thực tế</Text><Text style={s.muted}>Tổng hợp từ đến hạn SRS, từ chấm Again/Hard và từ nghe sai mới nhất. Không tự đổi lịch SRS khi chỉ xem danh sách.</Text>
        <View style={s.card}><Text style={s.stat}>{weak.length} từ cần chú ý</Text><Text>{due} từ đến hạn ôn · {Array.from(misses.values()).filter(Boolean).length} từ nghe sai gần nhất</Text></View>
        <Pressable disabled={!weakIds.length} style={[s.primary,!weakIds.length&&s.disabled]} onPress={()=>onSrsReview(weakIds)}><Text style={s.primaryText}>Bắt đầu ôn tối đa 20 từ →</Text></Pressable>
        {weak.slice(0,30).map(item=><View key={item.id} style={s.wordRow}><View style={{flex:1}}><Text style={s.word}>{item.word}</Text><Text>{item.meaning}</Text><Text style={s.muted}>{misses.get(String(item.id))?'Nghe sai · ':''}{reviewData[item.id]?.lastRating || 'Chưa có đánh giá SRS'}</Text></View><Pressable onPress={()=>play(item.word,true)} style={s.mini}><Text>🔊</Text></Pressable></View>)}
        {!weak.length && <Text style={s.muted}>Chưa có từ yếu hoặc từ đến hạn. Bạn có thể tiếp tục bài học mới.</Text>}
      </>}
      {tab==='test' && <>
        <Text style={s.section}>Test Center</Text><Text style={s.muted}>Bài kiểm tra tổng hợp ngẫu nhiên tối đa 10 từ đã học; nếu chưa đủ từ, dùng từ trong Day đang chọn. Dùng chung bộ chấm điểm và lịch sử Listening Quiz 7.0.</Text>
        <View style={s.card}><Text style={s.stat}>{testPool.length} từ đã học</Text><Text>{history.length} lượt kiểm tra được lưu · {favorites.length} từ yêu thích</Text></View>
        <Pressable disabled={testWords.length<4} style={[s.primary,testWords.length<4&&s.disabled]} onPress={()=>onTest(testWords)}><Text style={s.primaryText}>🎧 Bắt đầu kiểm tra tổng hợp →</Text></Pressable>
        <Pressable style={s.secondary} onPress={onListening}><Text style={s.secondaryText}>Kiểm tra riêng Day {currentDay} →</Text></Pressable>
        <Text style={s.muted}>Điểm Listening chỉ đo nhận biết nghĩa qua nghe; bản này chưa chấm chất lượng phát âm bằng AI.</Text>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
function Tile({icon,label,caption,onPress}) {return <Pressable onPress={onPress} style={s.tile}><Text style={s.tileIcon}>{icon}</Text><Text style={s.tileTitle}>{label}</Text><Text style={s.muted}>{caption}</Text></Pressable>;}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#F4F7FB'},header:{padding:16,backgroundColor:'#fff',flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderColor:'#E5EAF2'},back:{color:'#2354A5',fontWeight:'700'},headerTitle:{color:'#2354A5',fontSize:11,fontWeight:'800'},page:{padding:18,paddingBottom:48},title:{fontSize:26,fontWeight:'800',color:'#192B46'},muted:{fontSize:12,color:'#66758A',marginTop:4},tabRow:{flexDirection:'row',flexWrap:'wrap',marginTop:18,marginBottom:18,gap:6},tab:{paddingVertical:10,paddingHorizontal:12,borderRadius:11,backgroundColor:'#E5EAF2'},activeTab:{backgroundColor:'#2354A5'},tabLabel:{fontWeight:'700',fontSize:12,color:'#35506E'},activeTabText:{color:'#fff'},hero:{backgroundColor:'#2349A8',borderRadius:19,padding:20,marginBottom:14},heroSub:{color:'#E2ECFF',marginBottom:7},heroTitle:{fontSize:27,color:'#fff',fontWeight:'800',marginBottom:8},track:{height:8,backgroundColor:'#6D8FCA',borderRadius:5,overflow:'hidden',marginVertical:12},fill:{backgroundColor:'#fff',height:8},heroAction:{backgroundColor:'#fff',padding:13,borderRadius:11,alignItems:'center'},heroActionText:{color:'#2349A8',fontWeight:'800'},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between'},tile:{width:'48%',backgroundColor:'#fff',borderRadius:15,padding:17,marginBottom:12,borderWidth:1,borderColor:'#E5EAF2'},tileIcon:{fontSize:25,marginBottom:8},tileTitle:{fontWeight:'800',fontSize:16,color:'#243951'},card:{padding:17,borderRadius:15,backgroundColor:'#fff',borderWidth:1,borderColor:'#E5EAF2',marginVertical:12},section:{fontSize:18,fontWeight:'800',color:'#243951',marginBottom:8},secondary:{borderWidth:1,borderColor:'#B9CAE3',borderRadius:11,padding:14,marginVertical:9,alignItems:'center'},secondaryText:{color:'#2354A5',fontWeight:'800'},input:{backgroundColor:'#fff',borderRadius:12,borderWidth:1,borderColor:'#CCD9EA',padding:13,fontSize:15,marginVertical:8},accentRow:{flexDirection:'row',gap:8,marginVertical:8},accent:{padding:10,borderRadius:8,backgroundColor:'#E7EDF6'},accentActive:{backgroundColor:'#B6D0FC'},wordRow:{flexDirection:'row',backgroundColor:'#fff',padding:13,borderRadius:12,marginVertical:5,alignItems:'center',borderWidth:1,borderColor:'#E5EAF2',gap:8},word:{fontSize:15,fontWeight:'800',color:'#233D60',marginBottom:3},mini:{padding:10,backgroundColor:'#E9F1FC',borderRadius:9},primary:{backgroundColor:'#2354A5',padding:16,borderRadius:12,alignItems:'center',marginVertical:10},primaryText:{color:'#fff',fontWeight:'800'},disabled:{opacity:0.45},stat:{fontSize:24,fontWeight:'800',color:'#2354A5',marginBottom:6},error:{color:'#B3261E',marginBottom:8}});
