import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import WordVisual from './WordVisual';

// Additive data only. Existing SRS, listening quiz and recording-history keys are untouched.
export const PLUS_HISTORY_KEY = '@technical_english_plus_history_v1';
export const SPEAKING_REFLECTION_KEY = '@technical_english_speaking_reflection_v1';
const TODAY = () => new Date().toISOString().slice(0, 10);
const shuffle = input => [...input].sort(() => Math.random() - 0.5);
const normalize = value => String(value || '').toLowerCase().normalize('NFKC').replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
const getWords = (vocabulary, day) => vocabulary.filter(w => w.day === day);
const choiceLabel = item => item.meaning || item.word;
function newQuestion(items, index, mode) {
  const word = items[index];
  if (!word) return null;
  const distractors = shuffle(items.filter(x => x.id !== word.id && choiceLabel(x) !== choiceLabel(word))).slice(0, 3);
  const options = shuffle([word, ...distractors]).map(x => ({ id: x.id, value: choiceLabel(x) }));
  const phrase = String(word.example || word.word || '').trim();
  const token = String(word.word || '').trim();
  const fill = phrase.toLowerCase().includes(token.toLowerCase()) && token.length < phrase.length ? token : token.split(' ')[0];
  return { word, options, phrase, fill };
}
function Pill({ title, selected, onPress }) { return <Pressable accessibilityRole="button" onPress={onPress} style={[s.pill,selected&&s.pillActive]}><Text style={[s.pillText,selected&&s.pillTextActive]}>{title}</Text></Pressable>; }
export default function LearningPlus({ vocabulary, currentDay, reviewData, onHome, onSpeaking }) {
  const [mode,setMode] = useState('menu');
  const [accent,setAccent] = useState('en-US');
  const [queue,setQueue] = useState([]);
  const [index,setIndex] = useState(0);
  const [answer,setAnswer] = useState('');
  const [picked,setPicked] = useState(null);
  const [revealed,setRevealed] = useState(false);
  const [results,setResults] = useState([]);
  const [history,setHistory] = useState([]);
  const [reflections,setReflections] = useState({});
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  const savedRef = useRef(false);
  useEffect(()=>{ let active=true; (async()=>{ try {
    const [h,r] = await AsyncStorage.multiGet([PLUS_HISTORY_KEY,SPEAKING_REFLECTION_KEY]);
    if (!active) return;
    const hv=h[1]?JSON.parse(h[1]):[], rv=r[1]?JSON.parse(r[1]):{};
    setHistory(Array.isArray(hv)?hv:[]);
    setReflections(rv&&typeof rv==='object'&&!Array.isArray(rv)?rv:{});
  } catch(e){if(active)setError('Không tải được lịch sử nâng cao; dữ liệu học cũ vẫn được giữ nguyên.');}
  finally{if(active)setReady(true);} })();
  return()=>{active=false;Speech.stop().catch(()=>{});};},[]);
  const todays = useMemo(()=>getWords(vocabulary,currentDay),[vocabulary,currentDay]);
  const due = useMemo(()=>vocabulary.filter(w=>reviewData[w.id]&&Number(reviewData[w.id].nextReview)<=Date.now()),[vocabulary,reviewData]);
  const weakIds = useMemo(()=>{
    const ids=new Set();
    Object.entries(reviewData).forEach(([id,v])=>{if(v&&(v.lastRating==='again'||v.lastRating==='hard'||Number(v.nextReview)<=Date.now()))ids.add(String(id));});
    const latest=new Map();
    history.forEach(entry=>(entry.answers||[]).forEach(a=>{if(a?.id!=null&&!latest.has(String(a.id)))latest.set(String(a.id),!a.correct);}));
    latest.forEach((bad,id)=>{if(bad)ids.add(id);});
    Object.entries(reflections).forEach(([id,x])=>{if(x?.rating==='repeat')ids.add(id);});
    return ids;
  },[reviewData,history,reflections]);
  const weak = useMemo(()=>vocabulary.filter(w=>weakIds.has(String(w.id))),[vocabulary,weakIds]);
  const question = newQuestion(queue,index,mode);
  const current = queue[index];
  function speak(text,slow=false){if(!text)return;Speech.stop().then(()=>Speech.speak(text,{language:accent,rate:slow?0.68:0.92})).catch(()=>setError('Không thể phát âm; kiểm tra âm lượng và giọng đọc của thiết bị.'));}
  function enter(next){Speech.stop().catch(()=>{});setMode(next);setIndex(0);setPicked(null);setRevealed(false);setAnswer('');setResults([]);savedRef.current=false;}
  function start(next, pool){
    if(pool.length<(next==='meaning'?4:1)){Alert.alert('Chưa đủ dữ liệu','Hãy chọn bài có đủ từ vựng để luyện.');return;}
    setQueue(shuffle(pool).slice(0,10));enter(next);
  }
  function check(){
    if(revealed||!question)return;
    const target = mode==='meaning'?String(question.word.id):mode==='gap'?question.fill:question.word.word;
    const received = mode==='meaning'?String(picked):answer;
    if(!String(received||'').trim())return;
    const correct=mode==='meaning'?received===target:normalize(received)===normalize(target);
    setResults(old=>[...old,{id:question.word.id,correct,expected:target,entered:received,mode}]);
    setRevealed(true);
  }
  async function finish(){
    if(savedRef.current)return;
    savedRef.current=true;
    const record={date:TODAY(),timestamp:Date.now(),day:currentDay,mode,correct:results.filter(a=>a.correct).length,total:results.length,answers:results};
    try{const next=[record,...history].slice(0,120);await AsyncStorage.setItem(PLUS_HISTORY_KEY,JSON.stringify(next));setHistory(next);}
    catch(e){savedRef.current=false;setError('Chưa lưu được kết quả nâng cao. Hãy kiểm tra bộ nhớ điện thoại.');}
    setMode('result');
  }
  async function reflect(rating){
    if(!current||!ready)return;
    const next={...reflections,[String(current.id)]:{rating,updatedAt:Date.now()}};
    try{await AsyncStorage.setItem(SPEAKING_REFLECTION_KEY,JSON.stringify(next));setReflections(next);setError('Đã lưu tự đánh giá. Đây không phải điểm chấm phát âm tự động.');}
    catch(e){setError('Không lưu được tự đánh giá.');}
  }
  const wrong=history.reduce((n,h)=>n+(h.total-h.correct),0);
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Pressable accessibilityRole="button" hitSlop={10} style={s.back} onPress={()=>mode==='menu'?onHome():enter('menu')}><Text style={s.backText}>← {mode==='menu'?'Home':'Luyện tập'}</Text></Pressable><Text style={s.headerRight}>ENGLISH LEARNING 15.0</Text></View>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Learning Studio</Text><Text style={s.muted}>Day {currentDay}/30 · Listening · Visual · Speaking · Review</Text>
      {!!error&&<Text style={s.notice}>{error}</Text>}
      {mode==='menu'&&<>
        <View style={s.card}><Text style={s.heading}>🖼️ Visual Vocabulary</Text><Text style={s.muted}>Ảnh gợi nhớ có sẵn; có thể tìm ảnh thực tế khi có mạng. Tự nhớ nghĩa trước khi mở đáp án.</Text><Pressable style={s.action} onPress={()=>start('visual',todays)}><Text style={s.actionText}>Học thẻ hình ảnh →</Text></Pressable></View>
        <View style={s.card}><Text style={s.heading}>🎧 Listening Master</Text><Text style={s.muted}>Ba dạng: nghe chọn nghĩa, nghe chép từ và nghe điền chỗ trống.</Text><View style={s.stack}><Pressable style={s.action} onPress={()=>start('meaning',todays)}><Text style={s.actionText}>Nghe – chọn nghĩa</Text></Pressable><Pressable style={s.secondary} onPress={()=>start('dictation',todays)}><Text style={s.secondaryText}>Nghe – chép từ</Text></Pressable><Pressable style={s.secondary} onPress={()=>start('gap',todays)}><Text style={s.secondaryText}>Nghe – điền từ trong câu</Text></Pressable></View></View>
        <View style={s.card}><Text style={s.heading}>🎤 Speaking Coach</Text><Text style={s.muted}>Nghe mẫu, ghi âm và nghe lại bằng công cụ Speaking cũ. Tự đánh giá để tạo danh sách cần luyện lại; chưa có chấm điểm AI.</Text><Pressable style={s.action} onPress={()=>{setQueue(todays);enter('coach');}}><Text style={s.actionText}>Mở hướng dẫn luyện phát âm →</Text></Pressable></View>
        <View style={s.card}><Text style={s.heading}>🧠 Smart Review 2.0</Text><Text style={s.muted}>{due.length} từ đến hạn · {weak.length} từ cần chú ý · {history.length} lượt luyện nâng cao</Text><Text style={s.muted}>Tổng câu làm sai trong lịch sử nâng cao: {wrong}. Dữ liệu SRS cũ không bị thay đổi khi xem thống kê.</Text><Pressable style={s.action} onPress={()=>start('visual',weak.length?weak:todays)}><Text style={s.actionText}>Ôn tối đa 10 từ cần chú ý →</Text></Pressable></View>
      </>}
      {mode==='coach'&&<>
        <View style={s.card}><Text style={s.heading}>Luyện phát âm từng từ</Text><Text style={s.muted}>Chọn từ, nghe mẫu, mở màn hình Speaking để ghi âm và nghe lại; sau đó trở về tự đánh giá.</Text><View style={s.accentRow}>{[['en-US','🇺🇸 Anh–Mỹ'],['en-GB','🇬🇧 Anh–Anh']].map(([code,label])=><Pill key={code} selected={accent===code} title={label} onPress={()=>setAccent(code)}/>)}</View><Text style={s.word}>{current?.word||'Chưa có từ'}</Text><Text style={s.muted}>{current?.meaning}</Text><Pressable style={s.secondary} onPress={()=>speak(current?.word)}><Text style={s.secondaryText}>🔊 Nghe mẫu</Text></Pressable><Pressable style={s.action} onPress={onSpeaking}><Text style={s.actionText}>🎤 Mở ghi âm và nghe lại</Text></Pressable><Text style={s.muted}>Sau khi luyện nói, quay lại Learning Studio để tự đánh giá từ này.</Text><View style={s.accentRow}><Pill title="✓ Tự thấy ổn" onPress={()=>reflect('ok')} selected={reflections[String(current?.id)]?.rating==='ok'}/><Pill title="↻ Cần luyện lại" onPress={()=>reflect('repeat')} selected={reflections[String(current?.id)]?.rating==='repeat'}/></View><Pressable style={s.secondary} onPress={()=>setIndex(i=>Math.min(queue.length-1,i+1))}><Text style={s.secondaryText}>Từ tiếp theo →</Text></Pressable></View>
      </>}
      {mode==='visual'&&current&&<View style={s.card}><Text style={s.muted}>THẺ {index+1}/{queue.length} · {current.topic}</Text><Text style={s.word}>{current.word}</Text><WordVisual key={'visual-'+current.id} word={current.word} meaning={current.meaning} topic={current.topic}/><Pressable style={s.secondary} onPress={()=>speak(current.word)}><Text style={s.secondaryText}>🔊 Nghe từ</Text></Pressable>{revealed?<><Text style={s.answer}>{current.meaning}</Text><Text style={s.muted}>{current.example}</Text><Text style={s.muted}>{current.exampleVi}</Text></>:<Pressable style={s.action} onPress={()=>setRevealed(true)}><Text style={s.actionText}>Hiện nghĩa và ví dụ</Text></Pressable>}<Pressable style={s.secondary} onPress={()=>{if(index+1<queue.length){setIndex(i=>i+1);setRevealed(false);}else enter('menu');}}><Text style={s.secondaryText}>{index+1<queue.length?'Thẻ tiếp theo →':'Hoàn thành'}</Text></Pressable></View>}
      {['meaning','dictation','gap'].includes(mode)&&question&&<View style={s.card}>
        <Text style={s.muted}>CÂU {index+1}/{queue.length} · {mode==='meaning'?'NGHE CHỌN NGHĨA':mode==='dictation'?'NGHE CHÉP TỪ':'NGHE ĐIỀN CHỖ TRỐNG'}</Text>
        <View style={s.accentRow}>{[['en-US','🇺🇸 Anh–Mỹ'],['en-GB','🇬🇧 Anh–Anh']].map(([code,label])=><Pill key={code} title={label} selected={accent===code} onPress={()=>setAccent(code)}/>)}</View>
        <Pressable style={s.action} onPress={()=>speak(mode==='gap'?question.phrase:question.word.word)}><Text style={s.actionText}>🔊 Nghe câu hỏi</Text></Pressable><Pressable style={s.secondary} onPress={()=>speak(mode==='gap'?question.phrase:question.word.word,true)}><Text style={s.secondaryText}>🐢 Nghe chậm</Text></Pressable>
        {mode==='gap'&&<Text style={s.prompt}>{question.phrase.replace(new RegExp(question.fill.replace(/[.*+?^\u0024{}()|[\]\\]/g,'\\$&'),'i'),'_____')}</Text>}
        {mode==='meaning'?question.options.map((opt,i)=><Pressable disabled={revealed} key={opt.id} style={[s.option,picked===opt.id&&s.optionActive]} onPress={()=>setPicked(opt.id)}><Text>{String.fromCharCode(65+i)}. {opt.value}</Text></Pressable>):<TextInput style={s.input} editable={!revealed} autoCapitalize="none" autoCorrect={false} value={answer} onChangeText={setAnswer} placeholder="Nhập từ/cụm từ nghe được..." />}
        {!revealed?<Pressable disabled={mode==='meaning'?picked==null:!answer.trim()} style={s.action} onPress={check}><Text style={s.actionText}>Kiểm tra</Text></Pressable>:<><Text style={[s.feedback,{color:results[results.length-1]?.correct?'#167A51':'#BE3940'}]}>{results[results.length-1]?.correct?'✓ Chính xác':'✕ Chưa đúng'} · {question.word.word} — {question.word.meaning}</Text><Text style={s.muted}>{question.phrase}</Text><Pressable style={s.action} onPress={()=>{if(index+1<queue.length){setIndex(i=>i+1);setPicked(null);setAnswer('');setRevealed(false);}else finish();}}><Text style={s.actionText}>{index+1<queue.length?'Câu tiếp theo →':'Xem kết quả'}</Text></Pressable></>}
      </View>}
      {mode==='result'&&<View style={s.card}><Text style={s.heading}>Kết quả luyện nghe</Text><Text style={s.word}>{results.filter(a=>a.correct).length}/{results.length}</Text><Text style={s.muted}>Kết quả lưu riêng. Không tự ý thay đổi lịch SRS đã có.</Text><Pressable style={s.action} onPress={()=>enter('menu')}><Text style={s.actionText}>Quay lại Learning Studio</Text></Pressable></View>}
      {!ready&&<Text style={s.muted}>Đang tải lịch sử...</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:'#F5F8FF'},header:{backgroundColor:'#fff',paddingHorizontal:18,paddingVertical:6,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderColor:'#E6EBF5'},back:{minHeight:48,justifyContent:'center',paddingHorizontal:6},backText:{fontWeight:'800',color:'#2554B0'},headerRight:{color:'#748097',fontSize:11,fontWeight:'700'},page:{padding:17,paddingBottom:48,gap:13},title:{fontSize:24,fontWeight:'800',color:'#17345B'},heading:{fontSize:17,fontWeight:'800',color:'#17345B'},muted:{fontSize:12,lineHeight:19,color:'#66768F'},card:{backgroundColor:'#fff',padding:16,borderRadius:18,borderColor:'#DCE5F2',borderWidth:1,gap:10},action:{backgroundColor:'#3154CD',padding:15,borderRadius:12,alignItems:'center',minHeight:48,justifyContent:'center'},actionText:{color:'#fff',fontWeight:'800'},secondary:{backgroundColor:'#EDF3FF',padding:12,borderRadius:12,alignItems:'center',minHeight:44,justifyContent:'center'},secondaryText:{color:'#254A9C',fontWeight:'700'},stack:{gap:8},accentRow:{flexDirection:'row',flexWrap:'wrap',gap:8},pill:{borderRadius:10,padding:10,backgroundColor:'#EDF2FA',minHeight:42,justifyContent:'center'},pillActive:{backgroundColor:'#D9E5FF',borderWidth:1,borderColor:'#3565E9'},pillText:{fontSize:12,color:'#24456A'},pillTextActive:{fontWeight:'800'},word:{fontSize:27,fontWeight:'800',color:'#18355F',textAlign:'center',paddingVertical:8},answer:{fontSize:19,fontWeight:'800',color:'#2453B2',textAlign:'center'},prompt:{fontSize:16,lineHeight:25,textAlign:'center',color:'#234065'},option:{padding:14,minHeight:48,borderWidth:1,borderColor:'#DAE3F4',borderRadius:12,justifyContent:'center'},optionActive:{backgroundColor:'#E2ECFF',borderColor:'#3154CD'},input:{borderWidth:1,borderColor:'#AAB9D3',borderRadius:12,padding:14,fontSize:16,color:'#182C4C'},feedback:{fontWeight:'800',lineHeight:22},notice:{backgroundColor:'#FFF4D8',padding:10,color:'#77501C',borderRadius:8}
});
