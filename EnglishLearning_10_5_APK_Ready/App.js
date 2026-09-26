import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmExit, installAndroidBack } from './NavigationBack';
import WordVisual from './WordVisual';
import LearningPlus, { SPEAKING_REFLECTION_KEY } from './LearningPlus';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { vocabulary } from './vocabulary';
import LearningHub from './LearningHub';
import CloudBackup from './CloudBackup';
import * as Speech from 'expo-speech';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

const STORAGE_KEY = '@technical_english_srs_v4';
// Separate from SRS: save only practice counts, never audio files.
const SPEAKING_HISTORY_KEY = '@technical_english_speaking_history_v1';
// Independent of SRS and speaking history. Stores quiz results, not audio.
const LISTENING_HISTORY_KEY = '@technical_english_listening_history_v1';

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


const OLD_STORAGE_KEYS = [
  '@technical_english_progress_v4',
  '@technical_english_progress_v3',
];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;


// ===============================
// CREATE 30-DAY PLAN
// ===============================

const dayPlan = Array.from(
  { length: 30 },
  (_, index) => {

    const day = index + 1;

    const words = vocabulary.filter(
      (item) => item.day === day
    );

    const topics = [
      ...new Set(
        words.map(
          (item) => item.topic
        )
      ),
    ];

    const reviewDays = [];

    if (day - 1 >= 1) {
      reviewDays.push(
        `Day ${day - 1}`
      );
    }

    if (day - 3 >= 1) {
      reviewDays.push(
        `Day ${day - 3}`
      );
    }

    if (day - 7 >= 1) {
      reviewDays.push(
        `Day ${day - 7}`
      );
    }

    return {
      day,
      count: words.length,
      topic: topics.join(' → '),

      review:
        reviewDays.length > 0
          ? reviewDays.join(', ')
          : '—',
    };
  }
);


// ===============================
// MAIN APP
// ===============================

export default function App() {

  const [screen, setScreen] =
    useState('home');
  const previousScreenRef = useRef('home');
  const learnReturnRef = useRef('home');
  const speakingReturnRef = useRef('home');

  useEffect(() => {
    if (screen === 'learn' && previousScreenRef.current !== 'learn') {
      learnReturnRef.current = previousScreenRef.current === 'hub' ? 'hub' : 'home';
    }
    previousScreenRef.current = screen;
  }, [screen]);

  useEffect(() => installAndroidBack(() => {
    Speech.stop().catch(() => {});
    if (screen === 'home') { confirmExit(); return; }
    if (screen === 'learn') { setScreen(learnReturnRef.current); return; }
    const parent = {
      comprehensiveQuiz: 'hub', listeningReviewQuiz: 'listeningReview',
      listeningReview: 'home', speakingHistory: 'home',
      speaking: speakingReturnRef.current, plus: 'hub',
    }[screen] || 'home';
    setScreen(parent);
  }), [screen]);

  // Luyện nói độc lập: không chỉnh sửa dữ liệu SRS.
  const [speakingIndex, setSpeakingIndex] = useState(0);
  const [listeningReviewWords, setListeningReviewWords] = useState([]);
  const [comprehensiveWords, setComprehensiveWords] = useState([]);
  const [spokenWordIds, setSpokenWordIds] = useState([]);
  const [speakingHistory, setSpeakingHistory] = useState({});
  const [speakingReady, setSpeakingReady] = useState(false);
  const [speakingSaveError, setSpeakingSaveError] = useState(false);
  const [speakingReflections, setSpeakingReflections] = useState({});

  const [currentDay, setCurrentDay] =
    useState(1);

  const [reviewData, setReviewData] =
    useState({});

  const [sessionMode, setSessionMode] =
    useState('new');

  const [sessionIds, setSessionIds] =
    useState([]);

  const [sessionIndex, setSessionIndex] =
    useState(0);

  const [showMeaning, setShowMeaning] =
    useState(false);

  const [storageReady, setStorageReady] =
    useState(false);

  const [now, setNow] =
    useState(Date.now());


  // ===============================
  // LOAD DATA
  // ===============================

  useEffect(() => {
    loadProgress();
  }, []);


  // Load speaking statistics separately. Do not overwrite saved data before loading.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(SPEAKING_HISTORY_KEY);
        if (saved && active) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setSpeakingHistory(parsed);
          }
        }
      } catch (error) {
        console.log('Cannot load speaking history:', error);
      } finally {
        if (active) setSpeakingReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SPEAKING_REFLECTION_KEY).then(raw => {
      if (!live || !raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) setSpeakingReflections(parsed);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function setPronunciationReflection(item, rating) {
    if (!item) return;
    const next = { ...speakingReflections, [String(item.id)]: { rating, updatedAt: Date.now() } };
    try {
      await AsyncStorage.setItem(SPEAKING_REFLECTION_KEY, JSON.stringify(next));
      setSpeakingReflections(next);
    } catch (_) { Alert.alert('Chưa lưu được', 'Hãy thử lại sau khi kiểm tra dung lượng thiết bị.'); }
  }

  // Stats record only successful completed recordings; the audio itself remains temporary.
  useEffect(() => {
    if (!speakingReady) return;
    AsyncStorage.setItem(SPEAKING_HISTORY_KEY, JSON.stringify(speakingHistory))
      .then(() => setSpeakingSaveError(false))
      .catch(error => {
        console.log('Cannot save speaking history:', error);
        setSpeakingSaveError(true);
      });
  }, [speakingHistory, speakingReady]);

  function markWordRecorded(item) {
    if (!item || !speakingReady) return;
    const date = localDateKey();
    const lesson = String(currentDay);
    const wordId = String(item.id);
    setSpokenWordIds(old => old.includes(item.id) ? old : [...old, item.id]);
    setSpeakingHistory(old => {
      const dayEntry = old[date] || {};
      const lessonEntry = dayEntry[lesson] || {};
      return {
        ...old,
        [date]: {
          ...dayEntry,
          [lesson]: {
            ...lessonEntry,
            [wordId]: (Number(lessonEntry[wordId]) || 0) + 1,
          },
        },
      };
    });
  }

  // Update current time every minute

  useEffect(() => {

    const timer =
      setInterval(
        () => setNow(Date.now()),
        60 * 1000
      );

    return () =>
      clearInterval(timer);

  }, []);


  // Save progress automatically

  useEffect(() => {

    if (storageReady) {
      saveProgress();
    }

  }, [
    currentDay,
    reviewData,
    storageReady,
  ]);


  // ===============================
  // CURRENT DAY WORDS
  // ===============================

  const dayWords = useMemo(
    () =>
      vocabulary.filter(
        (item) =>
          item.day === currentDay
      ),
    [currentDay]
  );


  const currentPlan =
    dayPlan.find(
      (item) =>
        item.day === currentDay
    );


  // Words never studied

  const newWords =
    dayWords.filter(
      (item) =>
        !reviewData[item.id]
    );


  // ===============================
  // WORDS DUE FOR REVIEW
  // ===============================

  const dueWords = useMemo(
    () => {

      return vocabulary

        .filter(
          (item) => {

            const data =
              reviewData[item.id];

            return (
              data &&
              data.nextReview <= now
            );
          }
        )

        .sort(
          (a, b) =>
            reviewData[a.id]
              .nextReview -
            reviewData[b.id]
              .nextReview
        );

    },
    [
      reviewData,
      now,
    ]
  );


  // ===============================
  // DAY PROGRESS
  // ===============================

  const learned =
    dayWords.filter(
      (item) =>
        reviewData[item.id]
    ).length;


  const mastered =
    dayWords.filter(
      (item) =>
        isMastered(
          reviewData[item.id]
        )
    ).length;


  const progress =
    dayWords.length > 0
      ? Math.round(
          (
            learned /
            dayWords.length
          ) *
            100
        )
      : 0;


  // ===============================
  // OVERALL PROGRESS
  // ===============================

  const overallLearned =
    vocabulary.filter(
      (item) =>
        reviewData[item.id]
    ).length;


  const overallMastered =
    vocabulary.filter(
      (item) =>
        isMastered(
          reviewData[item.id]
        )
    ).length;


  const overallProgress =
    vocabulary.length > 0
      ? Math.round(
          (
            overallLearned /
            vocabulary.length
          ) *
            100
        )
      : 0;


  // ===============================
  // RATING COUNT
  // ===============================

  const ratingCounts = {

    again:
      dayWords.filter(
        (item) =>
          reviewData[item.id]
            ?.lastRating ===
          'again'
      ).length,

    hard:
      dayWords.filter(
        (item) =>
          reviewData[item.id]
            ?.lastRating ===
          'hard'
      ).length,

    good:
      dayWords.filter(
        (item) =>
          reviewData[item.id]
            ?.lastRating ===
          'good'
      ).length,

    easy:
      dayWords.filter(
        (item) =>
          reviewData[item.id]
            ?.lastRating ===
          'easy'
      ).length,
  };


  // ===============================
  // CURRENT SESSION WORD
  // ===============================

  const currentWordId =
    sessionIds[sessionIndex];


  const currentWord =
    vocabulary.find(
      (item) =>
        item.id === currentWordId
    );


  // ===============================
  // LOAD PROGRESS
  // ===============================

  async function loadProgress() {

    try {

      const savedData =
        await AsyncStorage.getItem(
          STORAGE_KEY
        );


      // Already using SRS

      if (savedData) {

        const data =
          JSON.parse(savedData);

        setCurrentDay(
          data.currentDay ?? 1
        );

        setReviewData(
          data.reviewData ?? {}
        );

        return;
      }


      // =========================
      // MIGRATE OLD PROGRESS
      // =========================

      for (
        const oldKey
        of OLD_STORAGE_KEYS
      ) {

        const oldSavedData =
          await AsyncStorage.getItem(
            oldKey
          );


        if (!oldSavedData) {
          continue;
        }


        const oldData =
          JSON.parse(
            oldSavedData
          );


        const migrated = {};

        const migrationTime =
          Date.now();


        Object.entries(
          oldData.ratings ?? {}
        ).forEach(
          ([id, rating]) => {

            const schedule =
              calculateSchedule(
                rating,
                null,
                migrationTime
              );


            migrated[id] = {

              lastRating:
                rating,

              lastReviewed:
                migrationTime,

              nextReview:
                schedule.nextReview,

              intervalDays:
                schedule.intervalDays,

              reviewCount: 1,
            };
          }
        );


        setCurrentDay(
          oldData.currentDay ?? 1
        );


        setReviewData(
          migrated
        );


        break;
      }

    } catch (error) {

      console.log(
        'Error loading progress:',
        error
      );

    } finally {

      setStorageReady(true);
    }
  }


  // ===============================
  // SAVE PROGRESS
  // ===============================

  async function saveProgress() {

    try {

      await AsyncStorage.setItem(

        STORAGE_KEY,

        JSON.stringify({

          currentDay,

          reviewData,
        })
      );

    } catch (error) {

      console.log(
        'Error saving progress:',
        error
      );
    }
  }


  // ===============================
  // SELECT DAY
  // ===============================

  function selectDay(day) {

    setCurrentDay(day);
    setSpeakingIndex(0);
    setSpokenWordIds([]);

    setShowMeaning(false);

    setSessionIds([]);

    setSessionIndex(0);

    setScreen('home');
  }


  // ===============================
  // START NEW WORDS
  // ===============================

  function startNewSession() {

    const ids =
      newWords.map(
        (item) => item.id
      );


    if (ids.length === 0) {
      return;
    }


    setSessionMode('new');

    setSessionIds(ids);

    setSessionIndex(0);

    setShowMeaning(false);

    setScreen('learn');
  }


  // ===============================
  // START REVIEW
  // ===============================

  function startReviewSession() {

    const ids =
      dueWords.map(
        (item) => item.id
      );


    if (ids.length === 0) {
      return;
    }


    setSessionMode('review');

    setSessionIds(ids);

    setSessionIndex(0);

    setShowMeaning(false);

    setScreen('learn');
  }


  // ===============================
  // RATE WORD
  // ===============================

  function rateWord(level) {

    if (!currentWord) {
      return;
    }


    const timestamp =
      Date.now();


    const previous =
      reviewData[
        currentWord.id
      ] ?? null;


    const schedule =
      calculateSchedule(

        level,

        previous,

        timestamp
      );


    setReviewData(
      (old) => ({

        ...old,

        [currentWord.id]: {

          lastRating:
            level,

          lastReviewed:
            timestamp,

          nextReview:
            schedule.nextReview,

          intervalDays:
            schedule.intervalDays,

          reviewCount:
            (
              previous
                ?.reviewCount ??
              0
            ) + 1,
        },
      })
    );


    setShowMeaning(false);


    // Next word

    if (
      sessionIndex <
      sessionIds.length - 1
    ) {

      setSessionIndex(
        sessionIndex + 1
      );

    } else {

      // Session complete

      setSessionIndex(0);

      setSessionIds([]);

      setScreen('home');

      setNow(
        Date.now()
      );
    }
  }


  // ===============================
  // RESET CURRENT DAY
  // ===============================

  async function resetDay() {

    const ids =
      new Set(

        dayWords.map(
          (item) =>
            String(item.id)
        )
      );


    const remaining = {};


    Object.entries(
      reviewData
    ).forEach(
      ([id, data]) => {

        if (
          !ids.has(
            String(id)
          )
        ) {

          remaining[id] =
            data;
        }
      }
    );


    setReviewData(
      remaining
    );


    setSessionIds([]);

    setSessionIndex(0);

    setShowMeaning(false);

    setNow(
      Date.now()
    );
  }


  // ===============================
  // LOADING SCREEN
  // ===============================

  if (!storageReady) {

    return (

      <SafeAreaView
        style={
          styles.loadingContainer
        }
      >

        <ActivityIndicator
          size="large"
        />


        <Text
          style={
            styles.loadingTitle
          }
        >
          TECHNICAL ENGLISH
        </Text>


        <Text
          style={
            styles.loadingText
          }
        >
          Loading your progress...
        </Text>

      </SafeAreaView>
    );
  }


  // ===============================
  // 30 DAY PLAN SCREEN
  // ===============================

  if (screen === 'days') {

    return (

      <SafeAreaView
        style={
          styles.container
        }
      >

        <View
          style={
            styles.topHeader
          }
        >

          <Pressable
            onPress={() =>
              setScreen('home')
            }
          >

            <Text
              style={
                styles.backButton
              }
            >
              ← Home
            </Text>

          </Pressable>


          <Text
            style={
              styles.headerTitle
            }
          >
            30-DAY PLAN
          </Text>


          <View
            style={
              styles.headerSpacer
            }
          />

        </View>


        <ScrollView
          contentContainerStyle={
            styles.daysContainer
          }
        >

          <View
            style={
              styles.overallCard
            }
          >

            <Text
              style={
                styles.overallTitle
              }
            >
              Overall Progress
            </Text>


            <Text
              style={
                styles.overallNumber
              }
            >
              {overallLearned}
              {' / '}
              {vocabulary.length}
            </Text>


            <View
              style={
                styles.progressBackground
              }
            >

              <View
                style={[
                  styles.progressBar,

                  {
                    width:
                      `${overallProgress}%`,
                  },
                ]}
              />

            </View>


            <Text
              style={
                styles.percentText
              }
            >
              {overallProgress}% completed
              {' · '}
              {overallMastered} mastered
            </Text>

          </View>


          {dayPlan.map(
            (plan) => {

              const words =
                vocabulary.filter(
                  (item) =>
                    item.day ===
                    plan.day
                );


              const done =
                words.filter(
                  (item) =>
                    reviewData[
                      item.id
                    ]
                ).length;


              const masteredForDay =
                words.filter(
                  (item) =>
                    isMastered(
                      reviewData[
                        item.id
                      ]
                    )
                ).length;


              const dayPercent =
                plan.count > 0
                  ? Math.round(
                      (
                        done /
                        plan.count
                      ) *
                        100
                    )
                  : 0;


              const isSelected =
                plan.day ===
                currentDay;


              return (

                <Pressable

                  key={
                    plan.day
                  }

                  style={[

                    styles.dayCard,

                    isSelected &&
                      styles.selectedDayCard,
                  ]}

                  onPress={() =>
                    selectDay(
                      plan.day
                    )
                  }
                >

                  <View
                    style={
                      styles.dayBadge
                    }
                  >

                    <Text
                      style={
                        styles.dayBadgeSmall
                      }
                    >
                      DAY
                    </Text>


                    <Text
                      style={
                        styles.dayBadgeNumber
                      }
                    >
                      {plan.day}
                    </Text>

                  </View>


                  <View
                    style={
                      styles.dayInfo
                    }
                  >

                    <Text
                      style={
                        styles.dayTopic
                      }
                    >
                      {plan.topic}
                    </Text>


                    <Text
                      style={
                        styles.dayMeta
                      }
                    >
                      {plan.count} words
                      {' · '}
                      {done}/{plan.count} learned
                      {' · '}
                      {masteredForDay} mastered
                    </Text>


                    <View
                      style={
                        styles.miniProgressBackground
                      }
                    >

                      <View
                        style={[
                          styles.miniProgressBar,

                          {
                            width:
                              `${dayPercent}%`,
                          },
                        ]}
                      />

                    </View>


                    {plan.review !==
                      '—' && (

                      <Text
                        style={
                          styles.reviewText
                        }
                      >
                        Review: {plan.review}
                      </Text>
                    )}

                  </View>


                  <Text
                    style={
                      styles.dayPercent
                    }
                  >
                    {dayPercent}%
                  </Text>

                </Pressable>
              );
            }
          )}

        </ScrollView>

      </SafeAreaView>
    );
  }


  // ===============================
  // HOME SCREEN
  // ===============================

  // V10: all new UI uses new keys. Existing V7 SRS and histories are never reset.
  if (screen === 'cloudBackup') {
    return <CloudBackup onHome={() => setScreen('home')} onImported={(snapshot) => {
      const progress = JSON.parse(snapshot.data[STORAGE_KEY]);
      setCurrentDay(progress.currentDay);
      setReviewData(progress.reviewData);
      const speakingRaw = snapshot.data[SPEAKING_HISTORY_KEY];
      if (speakingRaw) setSpeakingHistory(JSON.parse(speakingRaw));
      setScreen('home');
      Alert.alert('Đã khôi phục', 'Dữ liệu đã được nạp lại. Nếu đang dùng nhiều thiết bị, hãy kiểm tra tiến độ trước khi học tiếp.');
    }} />;
  }

  if (screen === 'plus') {
    return <LearningPlus vocabulary={vocabulary} currentDay={currentDay} reviewData={reviewData}
      onHome={() => setScreen('hub')}
      onSpeaking={() => { speakingReturnRef.current = 'plus'; setSpeakingIndex(0); setSpokenWordIds([]); setScreen('speaking'); }} />;
  }

  if (screen === 'hub') {
    return <LearningHub
      vocabulary={vocabulary} currentDay={currentDay} reviewData={reviewData}
      speakingHistory={speakingHistory} onHome={() => setScreen('home')}
      onPlus={() => setScreen('plus')}
      onDay={() => setScreen('days')}
      onLearn={() => { if (newWords.length) startNewSession(); else if (dueWords.length) startReviewSession(); else setScreen('days'); }}
      onSpeaking={() => { speakingReturnRef.current = 'home'; setSpeakingIndex(0); setSpokenWordIds([]); setScreen('speaking'); }}
      onListening={() => setScreen('listeningQuiz')}
      onTest={items => { setComprehensiveWords(items); setScreen('comprehensiveQuiz'); }}
      onSrsReview={ids => {
        setSessionMode('review'); setSessionIds(ids); setSessionIndex(0);
        setShowMeaning(false); setScreen('learn');
      }}
    />;
  }
  if (screen === 'comprehensiveQuiz') {
    return <ListeningQuiz key={'comprehensive-' + currentDay} day="Tổng hợp"
      words={comprehensiveWords} onHome={() => setScreen('hub')} />;
  }

  if (screen === 'home') {

    return (

      <SafeAreaView
        style={
          styles.container
        }
      >

        <ScrollView
          contentContainerStyle={
            styles.homeContainer
          }
        >

          <Text
            style={
              styles.appName
            }
          >
            TECHNICAL ENGLISH
          </Text>


          <Text
            style={
              styles.challenge
            }
          >
            1000 WORD CHALLENGE
          </Text>


          <Pressable

            style={
              styles.dayBox
            }

            onPress={() =>
              setScreen('days')
            }
          >

            <Text
              style={
                styles.daySmall
              }
            >
              CURRENT PLAN · TAP TO CHANGE DAY
            </Text>


            <Text
              style={
                styles.dayBig
              }
            >
              DAY {currentDay} / 30
            </Text>


            <Text
              style={
                styles.topicText
              }
            >
              {currentPlan
                ?.topic ||
                dayWords[0]
                  ?.topic ||
                ''}
            </Text>

          </Pressable>


          <Pressable style={styles.practiceHomeButton} onPress={() => setScreen('hub')}>
            <Text style={styles.practiceHomeTitle}>✨ MY LEARNING 10.0</Text>
            <Text style={styles.practiceHomeSubtitle}>Giao diện mới · Tra từ · Yêu thích · Smart Review · Test Center</Text>
          </Pressable>

          <Pressable style={styles.practiceHomeButton} onPress={() => setScreen('cloudBackup')}>
            <Text style={styles.practiceHomeTitle}>☁️ CLOUD BACKUP 10.5</Text>
            <Text style={styles.practiceHomeSubtitle}>Xuất bản sao lưu lên Google Drive · nhập lại khi đổi máy</Text>
          </Pressable>

          {/* NEW + REVIEW */}

          <View
            style={
              styles.todayGrid
            }
          >

            <View
              style={
                styles.todayCard
              }
            >

              <Text
                style={
                  styles.todayNumber
                }
              >
                {newWords.length}
              </Text>


              <Text
                style={
                  styles.todayLabel
                }
              >
                New words left
              </Text>

            </View>


            <View
              style={
                styles.todaySpacer
              }
            />


            <View
              style={
                styles.todayCard
              }
            >

              <Text
                style={
                  styles.todayNumber
                }
              >
                {dueWords.length}
              </Text>


              <Text
                style={
                  styles.todayLabel
                }
              >
                Review due
              </Text>

            </View>

          </View>


          {/* DAY PROGRESS */}

          <View
            style={
              styles.progressCard
            }
          >

            <View
              style={
                styles.rowBetween
              }
            >

              <Text
                style={
                  styles.sectionTitle
                }
              >
                Day {currentDay} Progress
              </Text>


              <Text
                style={
                  styles.progressNumber
                }
              >
                {learned}
                {' / '}
                {dayWords.length}
              </Text>

            </View>


            <View
              style={
                styles.progressBackground
              }
            >

              <View
                style={[
                  styles.progressBar,

                  {
                    width:
                      `${progress}%`,
                  },
                ]}
              />

            </View>


            <Text
              style={
                styles.percentText
              }
            >
              {progress}% completed
              {' · '}
              {mastered} mastered
            </Text>

          </View>


          {/* LEARN NEW WORDS */}

          <Pressable

            style={[

              styles.startButton,

              newWords.length ===
                0 &&
                styles.disabledButton,
            ]}

            onPress={
              startNewSession
            }

            disabled={
              newWords.length === 0
            }
          >

            <Text
              style={
                styles.startButtonText
              }
            >

              {newWords.length > 0

                ? `LEARN ${newWords.length} NEW WORD${
                    newWords.length === 1
                      ? ''
                      : 'S'
                  }`

                : `DAY ${currentDay} NEW WORDS COMPLETE`
              }

            </Text>

          </Pressable>


          {/* REVIEW BUTTON */}

          <Pressable

            style={[

              styles.reviewButton,

              dueWords.length ===
                0 &&
                styles.disabledReviewButton,
            ]}

            onPress={
              startReviewSession
            }

            disabled={
              dueWords.length === 0
            }
          >

            <Text
              style={[

                styles.reviewButtonText,

                dueWords.length ===
                  0 &&
                  styles.disabledReviewText,
              ]}
            >

              {dueWords.length > 0

                ? `REVIEW DUE (${dueWords.length})`

                : 'NO REVIEW DUE NOW'
              }

            </Text>

          </Pressable>


          {/* LISTENING QUIZ: tách biệt tiến độ SRS và lịch sử luyện nói */}
          <Pressable
            style={quizStyles.homeButton}
            disabled={dayWords.length < 2}
            onPress={() => setScreen('listeningQuiz')}
          >
            <Text style={quizStyles.homeTitle}>🎧 KIỂM TRA NGHE – CHỌN NGHĨA</Text>
            <Text style={quizStyles.homeSubtitle}>
              Day {currentDay} · Tối đa 10 câu · Nghe tiếng Anh, chọn nghĩa tiếng Việt
            </Text>
          </Pressable>

          <Pressable
            style={quizStyles.historyHomeButton}
            onPress={() => setScreen('listeningHistory')}
          >
            <Text style={quizStyles.homeTitle}>📊 LỊCH SỬ KIỂM TRA NGHE</Text>
            <Text style={quizStyles.homeSubtitle}>Điểm các lượt kiểm tra và từ đã trả lời sai</Text>
          </Pressable>

          <Pressable style={quizStyles.reviewHomeButton} onPress={() => setScreen('listeningReview')}>
            <Text style={quizStyles.homeTitle}>🎯 KHO TỪ NGHE SAI</Text>
            <Text style={quizStyles.homeSubtitle}>Tổng hợp từ nghe sai các ngày · chọn luyện lại 10 từ mỗi lượt</Text>
          </Pressable>

          <Pressable style={quizStyles.dashboardHomeButton} onPress={() => setScreen('listeningDashboard')}>
            <Text style={quizStyles.homeTitle}>📈 TIẾN ĐỘ NGHE 7 NGÀY</Text>
            <Text style={quizStyles.homeSubtitle}>Điểm trung bình · ngày luyện liên tiếp · mục tiêu hôm nay</Text>
          </Pressable>

          {/* LUYỆN NÓI THEO TỪ CỦA NGÀY HIỆN TẠI */}
          <Pressable
            style={styles.practiceHomeButton}
            onPress={() => {
              setSpeakingIndex(0);
              setSpokenWordIds([]);
              setScreen('speaking');
            }}
            disabled={dayWords.length === 0 || !speakingReady}
          >
            <Text style={styles.practiceHomeTitle}>🎤 LUYỆN NÓI THEO BÀI</Text>
            <Text style={styles.practiceHomeSubtitle}>
              Day {currentDay} · {dayWords.length} từ/cụm từ · nghe mẫu → ghi âm → nghe lại
            </Text>
          </Pressable>

          <Pressable
            style={styles.historyHomeButton}
            onPress={() => setScreen('speakingHistory')}
          >
            <Text style={styles.historyHomeTitle}>📊 LỊCH SỬ LUYỆN NÓI</Text>
            <Text style={styles.practiceHomeSubtitle}>Xem số từ và số lượt ghi âm theo ngày</Text>
          </Pressable>

          {/* PLAN */}

          <Pressable

            style={
              styles.planButton
            }

            onPress={() =>
              setScreen('days')
            }
          >

            <Text
              style={
                styles.planButtonText
              }
            >
              VIEW 30-DAY PLAN
            </Text>

          </Pressable>


          {/* OVERALL */}

          <View
            style={
              styles.overallMiniCard
            }
          >

            <View
              style={
                styles.rowBetween
              }
            >

              <Text
                style={
                  styles.sectionTitle
                }
              >
                Overall
              </Text>


              <Text
                style={
                  styles.progressNumber
                }
              >
                {overallLearned}
                {' / '}
                {vocabulary.length}
              </Text>

            </View>


            <View
              style={
                styles.progressBackground
              }
            >

              <View
                style={[
                  styles.progressBar,

                  {
                    width:
                      `${overallProgress}%`,
                  },
                ]}
              />

            </View>


            <Text
              style={
                styles.percentText
              }
            >
              {overallMastered} mastered
            </Text>

          </View>


          {/* RATING SUMMARY */}

          <Text
            style={
              styles.todayTitle
            }
          >
            Last Rating · Day {currentDay}
          </Text>


          <View
            style={
              styles.ratingSummary
            }
          >

            <Summary
              number={
                ratingCounts.again
              }
              label="Again"
            />

            <Summary
              number={
                ratingCounts.hard
              }
              label="Hard"
            />

            <Summary
              number={
                ratingCounts.good
              }
              label="Good"
            />

            <Summary
              number={
                ratingCounts.easy
              }
              label="Easy"
            />

          </View>


          {/* SRS INFORMATION */}

          <View
            style={
              styles.srsInfoCard
            }
          >

            <Text
              style={
                styles.srsInfoTitle
              }
            >
              How review scheduling works
            </Text>


            <Text
              style={
                styles.srsInfoText
              }
            >
              Again → about 10 minutes
            </Text>


            <Text
              style={
                styles.srsInfoText
              }
            >
              Hard → about 1 day
            </Text>


            <Text
              style={
                styles.srsInfoText
              }
            >
              Good → about 2 days
            </Text>


            <Text
              style={
                styles.srsInfoText
              }
            >
              Easy → about 4 days
            </Text>


            <Text
              style={
                styles.srsNote
              }
            >
              Intervals grow automatically after later reviews.
            </Text>

          </View>


          {/* RESET */}

          <Pressable

            style={
              styles.resetButton
            }

            onPress={
              resetDay
            }
          >

            <Text
              style={
                styles.resetText
              }
            >
              Reset Day {currentDay}
            </Text>

          </Pressable>

        </ScrollView>

      </SafeAreaView>
    );
  }


  if (screen === 'listeningDashboard') {
    return <ListeningDashboard
      onHome={() => setScreen('home')}
      onQuiz={() => setScreen('listeningQuiz')}
      onReview={() => setScreen('listeningReview')}
      canQuiz={dayWords.length >= 2}
    />;
  }

  if (screen === 'listeningHistory') {
    return <ListeningHistory onHome={() => setScreen('home')} />;
  }

  if (screen === 'listeningReview') {
    return <ListeningReviewBank
      onHome={() => setScreen('home')}
      onStart={items => { setListeningReviewWords(items); setScreen('listeningReviewQuiz'); }}
    />;
  }

  if (screen === 'listeningReviewQuiz') {
    return <ListeningQuiz
      key={`review-${listeningReviewWords.map(item => item.id).join('-')}`}
      day="Tổng hợp"
      words={listeningReviewWords}
      initialMode="review"
      onHome={() => setScreen('listeningReview')}
    />;
  }

  // Quiz ở component riêng để không ảnh hưởng state của phiên học/SRS.
  if (screen === 'listeningQuiz') {
    return (
      <ListeningQuiz
        key={`listening-${currentDay}`}
        day={currentDay}
        words={dayWords}
        onHome={() => setScreen('home')}
      />
    );
  }

  // ===============================
  // SPEAKING HISTORY: 7 RECENT CALENDAR DAYS
  // ===============================
  if (screen === 'speakingHistory') {
    const today = new Date();
    const sevenDays = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      const key = localDateKey(date);
      const dayData = speakingHistory[key] || {};
      const lessonEntries = Object.entries(dayData);
      const attempts = lessonEntries.reduce((sum, [, words]) =>
        sum + Object.values(words || {}).reduce((n, count) => n + (Number(count) || 0), 0), 0);
      const unique = lessonEntries.reduce((sum, [, words]) => sum + Object.keys(words || {}).length, 0);
      return { key, attempts, unique, lessons: lessonEntries.length };
    });
    const totalAttempts = sevenDays.reduce((sum, day) => sum + day.attempts, 0);
    const totalUnique = sevenDays.reduce((sum, day) => sum + day.unique, 0);
    const thisLesson = speakingHistory[localDateKey()]?.[String(currentDay)] || {};
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.learnHeader}>
          <Pressable onPress={() => setScreen('home')}>
            <Text style={styles.backButton}>← Home</Text>
          </Pressable>
          <Text style={styles.wordCounter}>SPEAKING HISTORY</Text>
        </View>
        <ScrollView contentContainerStyle={styles.practiceScreen}>
          <Text style={styles.practiceEyebrow}>THỐNG KÊ LUYỆN NÓI</Text>
          <Text style={styles.historyHeading}>7 ngày gần nhất</Text>
          <View style={styles.historySummary}>
            <Text style={styles.historyBigNumber}>{totalUnique} từ-ngày · {totalAttempts} lượt ghi âm</Text>
            <Text style={styles.practiceHomeSubtitle}>Mỗi từ trong mỗi ngày học được tính một lần; ghi âm lại tăng số lượt.</Text>
          </View>
          <Text style={styles.practiceProgressTitle}>
            Hôm nay · Day {currentDay}: {Object.keys(thisLesson).length}/{dayWords.length} từ
          </Text>
          {sevenDays.map(day => (
            <View key={day.key} style={styles.historyRow}>
              <Text style={styles.historyDate}>{day.key}</Text>
              <Text style={styles.historyNumber}>{day.unique} từ · {day.attempts} lượt</Text>
            </View>
          ))}
          {speakingSaveError && (
            <Text style={styles.speechError}>Chưa lưu được lịch sử. Kiểm tra dung lượng thiết bị và thử lại.</Text>
          )}
          <Text style={styles.practiceFooter}>
            Thống kê lưu trên điện thoại bằng AsyncStorage. Không lưu file ghi âm, không tự chấm điểm phát âm và không thay đổi tiến độ ôn tập.
          </Text>
          <Pressable style={styles.practiceHomeButton} onPress={() => {
            setSpeakingIndex(0);
            setSpokenWordIds([]);
            setScreen('speaking');
          }}>
            <Text style={styles.practiceHomeTitle}>🎤 BẮT ĐẦU LƯỢT LUYỆN MỚI</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ===============================
  // SPEAKING PRACTICE: THEO TỪ TRONG NGÀY
  // ===============================
  if (screen === 'speaking') {
    const total = dayWords.length;
    const item = dayWords[speakingIndex];
    const practiced = spokenWordIds.length;
    const todayLesson = speakingHistory[localDateKey()]?.[String(currentDay)] || {};
    const todayUnique = Object.keys(todayLesson).length;
    const todayAttempts = Object.values(todayLesson).reduce((sum, count) => sum + (Number(count) || 0), 0);

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.learnHeader}>
          <Pressable onPress={() => setScreen(speakingReturnRef.current)}>
            <Text style={styles.backButton}>← Home</Text>
          </Pressable>
          <Text style={styles.wordCounter}>DAY {currentDay} · SPEAKING</Text>
        </View>
        <ScrollView contentContainerStyle={styles.practiceScreen}>
          <Text style={styles.practiceEyebrow}>LUYỆN NÓI THEO BÀI</Text>
          <Text style={styles.practiceProgressTitle}>
            Đã luyện {practiced}/{total} từ · Từ {speakingIndex + 1}/{total}
          </Text>
          <Text style={styles.practiceDayCount}>
            Hôm nay: {todayUnique}/{total} từ đã luyện · {todayAttempts} lượt ghi âm
          </Text>
          <View style={styles.practiceTrack}>
            <View style={[styles.practiceFill, { width: `${total ? (practiced / total) * 100 : 0}%` }]} />
          </View>
          {item ? (
            <>
              <View style={styles.practiceWordCard}>
                <Text style={styles.practiceTopic}>{item.topic}</Text>
                <Text style={styles.practiceWord}>{item.word}</Text>
                <Text style={styles.practiceMeaning}>{item.meaning}</Text>
                <WordVisual key={`speaking-picture-${item.id}`} word={item.word} meaning={item.meaning} topic={item.topic} compact />
                {!!item.example && <Text style={styles.practiceExample}>{item.example}</Text>}
                {!!item.exampleVi && <Text style={styles.practiceExampleVi}>{item.exampleVi}</Text>}
                <Text style={styles.practiceStatus}>
                  {spokenWordIds.includes(item.id) ? '✓ Đã ghi âm trong lượt này' : '○ Chưa ghi âm trong lượt này'}
                </Text>
              </View>
              <PronunciationPanel
                key={`speaking-${item.id}`}
                word={item.word}
                example={item.example}
                showExample={true}
                practiceMode={true}
                onRecorded={() => markWordRecorded(item)}
                canPrev={speakingIndex > 0}
                canNext={speakingIndex < total - 1}
                onPrev={() => setSpeakingIndex(i => Math.max(0, i - 1))}
                onNext={() => setSpeakingIndex(i => Math.min(total - 1, i + 1))}
                onFinish={() => setScreen('speakingHistory')}
              />
              <View style={{backgroundColor:'#FFFFFF',borderRadius:14,padding:14,marginTop:12,gap:8}}>
                <Text style={{fontWeight:'800',color:'#17345B'}}>Tự đánh giá sau khi nghe lại</Text>
                <Text style={{color:'#66758A',fontSize:12}}>Đây là đánh giá của bạn, không phải điểm phát âm do AI chấm.</Text>
                <Pressable onPress={() => setPronunciationReflection(item,'ok')} style={{minHeight:44,justifyContent:'center',backgroundColor:'#E9F8F0',padding:12,borderRadius:10}}><Text style={{color:'#176545',fontWeight:'700'}}>✓ Tự thấy ổn {speakingReflections[String(item.id)]?.rating==='ok'?'(đã lưu)':''}</Text></Pressable>
                <Pressable onPress={() => setPronunciationReflection(item,'repeat')} style={{minHeight:44,justifyContent:'center',backgroundColor:'#FFF3E6',padding:12,borderRadius:10}}><Text style={{color:'#83511D',fontWeight:'700'}}>↻ Cần luyện lại {speakingReflections[String(item.id)]?.rating==='repeat'?'(đã lưu)':''}</Text></Pressable>
              </View>
            </>
          ) : <Text>Ngày này chưa có từ vựng.</Text>}
          <Text style={styles.practiceFooter}>
            Dấu ✓ nghĩa là bạn đã ghi âm, không phải điểm đánh giá phát âm.
            Thống kê số từ và lượt ghi âm được lưu riêng, không thay đổi lịch ôn tập SRS.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ===============================
  // SESSION COMPLETE
  // ===============================

  if (!currentWord) {

    return (

      <SafeAreaView
        style={
          styles.loadingContainer
        }
      >

        <Text
          style={
            styles.loadingTitle
          }
        >
          Session complete
        </Text>


        <Pressable

          style={
            styles.startButton
          }

          onPress={() =>
            setScreen('home')
          }
        >

          <Text
            style={
              styles.startButtonText
            }
          >
            BACK HOME
          </Text>

        </Pressable>

      </SafeAreaView>
    );
  }


  // ===============================
  // SCHEDULE LABELS
  // ===============================

  const scheduleLabels =
    getScheduleLabels(

      reviewData[
        currentWord.id
      ]
    );


  // ===============================
  // LEARNING SCREEN
  // ===============================

  return (

    <SafeAreaView
      style={
        styles.container
      }
    >

      <View
        style={
          styles.learnHeader
        }
      >

        <Pressable

          onPress={() =>
            setScreen(learnReturnRef.current)
          }
        >

          <Text
            style={
              styles.backButton
            }
          >
            ← Home
          </Text>

        </Pressable>


        <Text
          style={
            styles.wordCounter
          }
        >

          {sessionMode ===
          'review'

            ? 'REVIEW'

            : `DAY ${currentDay}`
          }

          {' · '}

          {sessionIndex + 1}

          {' / '}

          {sessionIds.length}

        </Text>

      </View>


      <ScrollView
        contentContainerStyle={
          styles.learnContainer
        }
      >

        {/* SESSION BADGE */}

        <View
          style={[

            styles.sessionBadge,

            sessionMode ===
              'review' &&
              styles.reviewSessionBadge,
          ]}
        >

          <Text
            style={[

              styles.sessionBadgeText,

              sessionMode ===
                'review' &&
                styles.reviewSessionBadgeText,
            ]}
          >

            {sessionMode ===
            'review'

              ? 'SPACED REVIEW'

              : 'NEW WORD'
            }

          </Text>

        </View>


        {/* TOPIC */}

        <Text
          style={
            styles.topic
          }
        >
          {currentWord.topic}
        </Text>


        {/* FLASHCARD */}

        <Pressable

          style={
            styles.flashcard
          }

          onPress={() =>
            setShowMeaning(
              !showMeaning
            )
          }
        >

          <Text
            style={
              styles.word
            }
          >
            {currentWord.word}
          </Text>


          {!showMeaning ? (

            <View>

              <Text
                style={
                  styles.tapText
                }
              >
                Tap to show meaning
              </Text>


              <Text
                style={
                  styles.questionMark
                }
              >
                ?
              </Text>

            </View>

          ) : (

            <View>

              <Text
                style={
                  styles.meaning
                }
              >
                {currentWord.meaning}
              </Text>


              <View
                style={
                  styles.divider
                }
              />


              <Text
                style={
                  styles.exampleLabel
                }
              >
                EXAMPLE
              </Text>


              <Text
                style={
                  styles.example
                }
              >
                {currentWord.example}
              </Text>


              <Text
                style={
                  styles.exampleVi
                }
              >
                {currentWord.exampleVi}
              </Text>

            </View>
          )}

        </Pressable>

        {showMeaning && <WordVisual key={`learn-picture-${currentWord.id}`} word={currentWord.word} meaning={currentWord.meaning} topic={currentWord.topic} />}

        <PronunciationPanel
          key={currentWord.id}
          word={currentWord.word}
          example={currentWord.example}
          showExample={showMeaning}
        />

        {/* INSTRUCTION */}

        {!showMeaning ? (

          <Text
            style={
              styles.instruction
            }
          >
            Hãy tự nhớ nghĩa trước khi mở đáp án
          </Text>

        ) : (

          <View>

            <Text
              style={
                styles.ratingQuestion
              }
            >
              Bạn nhớ từ này ở mức nào?
            </Text>


            <View
              style={
                styles.ratingButtons
              }
            >

              <RateButton

                label="AGAIN"

                sub={
                  scheduleLabels.again
                }

                style={
                  styles.againButton
                }

                onPress={() =>
                  rateWord('again')
                }
              />


              <RateButton

                label="HARD"

                sub={
                  scheduleLabels.hard
                }

                style={
                  styles.hardButton
                }

                onPress={() =>
                  rateWord('hard')
                }
              />


              <RateButton

                label="GOOD"

                sub={
                  scheduleLabels.good
                }

                style={
                  styles.goodButton
                }

                onPress={() =>
                  rateWord('good')
                }
              />


              <RateButton

                label="EASY"

                sub={
                  scheduleLabels.easy
                }

                style={
                  styles.easyButton
                }

                onPress={() =>
                  rateWord('easy')
                }
              />

            </View>

          </View>
        )}

      </ScrollView>

    </SafeAreaView>
  );
}


// ===============================
// SPACED REPETITION ALGORITHM
// ===============================

function calculateSchedule(
  level,
  previous,
  timestamp
) {

  const previousInterval =
    previous?.intervalDays ??
    0;


  // AGAIN
  // Review again in 10 minutes

  if (level === 'again') {

    return {

      intervalDays: 0,

      nextReview:
        timestamp +
        10 * MINUTE,
    };
  }


  // HARD

  if (level === 'hard') {

    const intervalDays =
      previousInterval > 0

        ? Math.max(
            1,
            Math.round(
              previousInterval *
              1.5
            )
          )

        : 1;


    return {

      intervalDays,

      nextReview:
        timestamp +
        intervalDays *
          DAY,
    };
  }


  // GOOD

  if (level === 'good') {

    const intervalDays =
      previousInterval > 0

        ? Math.max(
            2,
            Math.round(
              previousInterval *
              2.5
            )
          )

        : 2;


    return {

      intervalDays,

      nextReview:
        timestamp +
        intervalDays *
          DAY,
    };
  }


  // EASY

  const intervalDays =
    previousInterval > 0

      ? Math.max(
          4,
          Math.round(
            previousInterval *
            3.5
          )
        )

      : 4;


  return {

    intervalDays,

    nextReview:
      timestamp +
      intervalDays *
        DAY,
  };
}


// ===============================
// BUTTON LABEL INTERVAL
// ===============================

function getScheduleLabels(
  previous
) {

  const timestamp =
    Date.now();


  return {

    again:
      '10 min',

    hard:
      formatInterval(

        calculateSchedule(
          'hard',
          previous,
          timestamp
        ).intervalDays
      ),

    good:
      formatInterval(

        calculateSchedule(
          'good',
          previous,
          timestamp
        ).intervalDays
      ),

    easy:
      formatInterval(

        calculateSchedule(
          'easy',
          previous,
          timestamp
        ).intervalDays
      ),
  };
}


// ===============================
// FORMAT INTERVAL
// ===============================

function formatInterval(days) {

  if (days <= 1) {
    return '1 day';
  }

  return `${days} days`;
}


// ===============================
// MASTERED LOGIC
// ===============================

function isMastered(data) {

  if (!data) {
    return false;
  }

  return (
    data.intervalDays >= 14 ||
    data.lastRating === 'easy'
  );
}


// ===============================
// SUMMARY
// ===============================

function Summary({
  number,
  label,
}) {

  return (

    <View>

      <Text
        style={
          styles.ratingNumber
        }
      >
        {number}
      </Text>


      <Text
        style={
          styles.ratingText
        }
      >
        {label}
      </Text>

    </View>
  );
}


// ===============================
// RATE BUTTON
// ===============================

function RateButton({
  label,
  sub,
  style,
  onPress,
}) {

  return (

    <Pressable

      style={[
        styles.ratingButton,
        style,
      ]}

      onPress={
        onPress
      }
    >

      <Text
        style={
          styles.ratingButtonText
        }
      >
        {label}
      </Text>


      <Text
        style={
          styles.ratingButtonSmall
        }
      >
        {sub}
      </Text>

    </Pressable>
  );
}



// =====================================================
// PRONUNCIATION: device text-to-speech + dictionary IPA
// =====================================================
const phoneticCache = new Map();

// ===============================
// LISTENING QUIZ 5.0: separate score history; never modify SRS or speaking stats.
// ===============================
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makeListeningQuestions(words) {
  const valid = words.filter(item =>
    item && String(item.word || '').trim() && String(item.meaning || '').trim()
  );
  const seen = new Set();
  const unique = valid.filter(item => {
    const key = item.meaning.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const allMeanings = [...new Set(
    vocabulary.map(item => String(item.meaning || '').trim()).filter(Boolean)
  )];
  return shuffled(unique).slice(0, 10).map(item => {
    const correct = item.meaning.trim();
    const sameDay = [...new Set(unique.map(other => other.meaning.trim()))]
      .filter(meaning => meaning !== correct);
    const fallback = allMeanings.filter(meaning =>
      meaning !== correct && !sameDay.includes(meaning)
    );
    const distractors = [...shuffled(sameDay), ...shuffled(fallback)].slice(0, 3);
    return { ...item, options: shuffled([correct, ...distractors]) };
  }).filter(question => question.options.length === 4);
}

async function saveListeningResult(entry) {
  // Read first so old scores are not overwritten after an app reload.
  const raw = await AsyncStorage.getItem(LISTENING_HISTORY_KEY);
  const old = raw ? JSON.parse(raw) : [];
  const history = Array.isArray(old) ? old : [];
  await AsyncStorage.setItem(LISTENING_HISTORY_KEY,
    JSON.stringify([entry, ...history].slice(0, 100)));
}

// V6: derives the review queue from the existing V5 history. No migration or new storage key.
// Legacy V5 entries only stored wrong answers; V6 entries also store each answer outcome.
function listeningReviewBank(history) {
  const byId = new Map();
  // newest entry first: the first known outcome for an item is the latest outcome.
  for (const entry of history) {
    const outcomes = Array.isArray(entry.answers) ? entry.answers :
      (Array.isArray(entry.mistakes) ? entry.mistakes.map(item => ({ ...item, correct: false })) : []);
    for (const answer of outcomes) {
      const id = String(answer.id);
      if (!id || id === 'undefined') continue;
      const current = byId.get(id) || { id, wrongCount: 0, latest: null, lastWrong: '' };
      if (current.latest === null) current.latest = Boolean(answer.correct);
      if (!answer.correct) {
        current.wrongCount += 1;
        if (!current.lastWrong) current.lastWrong = entry.date || '';
      }
      byId.set(id, current);
    }
  }
  return [...byId.values()].filter(item => item.latest === false)
    .map(item => {
      const word = vocabulary.find(v => String(v.id) === item.id);
      return word ? { ...word, ...item } : null;
    }).filter(Boolean)
    .sort((a, b) => b.wrongCount - a.wrongCount || a.word.localeCompare(b.word));
}

// V7: Read-only listening dashboard, derived from the existing V5/V6 result history.
// No new storage key, no mutation of SRS, and no invented scores for missing days.
function buildListeningDashboard(history, today = new Date()) {
  const entries = Array.isArray(history) ? history : [];
  const valid = entries.filter(entry => entry && Number(entry.total) > 0 &&
    Number.isFinite(Number(entry.correct)) && Number(entry.correct) >= 0 &&
    Number(entry.correct) <= Number(entry.total) && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '')));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    const key = localDateKey(date);
    const matches = valid.filter(entry => entry.date === key);
    const questions = matches.reduce((sum, entry) => sum + Number(entry.total), 0);
    const correct = matches.reduce((sum, entry) => sum + Number(entry.correct), 0);
    return { key, label: `${date.getDate()}/${date.getMonth() + 1}`, attempts: matches.length,
      questions, correct, percent: questions ? Math.round(100 * correct / questions) : null };
  });
  const todayData = days[6];
  const attempts = days.reduce((sum, day) => sum + day.attempts, 0);
  const questions = days.reduce((sum, day) => sum + day.questions, 0);
  const correct = days.reduce((sum, day) => sum + day.correct, 0);
  const activeDays = days.filter(day => day.attempts > 0).length;
  const allDates = new Set(valid.map(entry => entry.date));
  let streak = 0;
  // Today may be unfinished; count the run ending yesterday in that case.
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (allDates.has(localDateKey(today)) ? 0 : 1));
  while (allDates.has(localDateKey(cursor)) && streak < 100) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, todayData, attempts, questions, correct, activeDays, streak,
    percent: questions ? Math.round(100 * correct / questions) : null };
}

function ListeningDashboard({ onHome, onQuiz, onReview, canQuiz }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LISTENING_HISTORY_KEY).then(raw => {
      if (!active) return;
      const parsed = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(parsed) ? parsed : []);
    }).catch(() => { if (active) setError('Không đọc được lịch sử nghe. Hãy thử mở lại màn hình.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const stats = useMemo(() => buildListeningDashboard(history), [history]);
  const bank = useMemo(() => listeningReviewBank(history), [history]);
  const goal = 1; // At least one completed Listening Quiz each calendar day.
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.learnHeader}>
        <Pressable onPress={onHome}><Text style={styles.backButton}>← Home</Text></Pressable>
        <Text style={styles.wordCounter}>LISTENING · 7 DAYS</Text>
      </View>
      <ScrollView contentContainerStyle={quizStyles.screen}>
        <Text style={quizStyles.eyebrow}>📈 LISTENING QUIZ 7.0</Text>
        <Text style={quizStyles.heading}>Tiến độ luyện nghe</Text>
        {loading ? <ActivityIndicator /> : error ? <Text style={quizStyles.error}>{error}</Text> : (
          <>
            <View style={quizStyles.historyCard}>
              <Text style={quizStyles.historyTitle}>Mục tiêu hôm nay: {goal} bài hoàn thành</Text>
              <Text style={quizStyles.historyScore}>{stats.todayData.attempts >= goal ? '✓ Đã đạt' : `${stats.todayData.attempts}/${goal} bài`}</Text>
              <Text style={quizStyles.help}>Tính cả bài kiểm tra thường và lượt luyện lại đã lưu thành công.</Text>
            </View>
            <View style={quizStyles.dashboardGrid}>
              <View style={quizStyles.dashboardTile}>
                <Text style={quizStyles.dashboardNumber}>{stats.percent === null ? '—' : `${stats.percent}%`}</Text>
                <Text style={quizStyles.dashboardCaption}>Tỷ lệ đúng 7 ngày</Text>
              </View>
              <View style={quizStyles.dashboardTile}>
                <Text style={quizStyles.dashboardNumber}>{stats.streak}</Text>
                <Text style={quizStyles.dashboardCaption}>Ngày luyện liên tiếp</Text>
              </View>
              <View style={quizStyles.dashboardTile}>
                <Text style={quizStyles.dashboardNumber}>{stats.attempts}</Text>
                <Text style={quizStyles.dashboardCaption}>Lượt đã hoàn thành</Text>
              </View>
              <View style={quizStyles.dashboardTile}>
                <Text style={quizStyles.dashboardNumber}>{bank.length}</Text>
                <Text style={quizStyles.dashboardCaption}>Từ đang cần ôn</Text>
              </View>
            </View>
            <Text style={quizStyles.prompt}>Kết quả 7 ngày gần nhất</Text>
            {stats.days.map(day => (
              <View key={day.key} style={quizStyles.dashboardDay}>
                <View style={quizStyles.dashboardDayHeader}>
                  <Text style={quizStyles.historyTitle}>{day.label}</Text>
                  <Text style={quizStyles.historyWord}>{day.attempts ? `${day.attempts} lượt · ${day.correct}/${day.questions} đúng (${day.percent}%)` : 'Chưa có bài hoàn thành'}</Text>
                </View>
                <View style={quizStyles.track}>
                  <View style={[quizStyles.fill, { width: `${day.percent === null ? 0 : day.percent}%` }]} />
                </View>
              </View>
            ))}
            <Text style={quizStyles.help}>Đã luyện {stats.activeDays}/7 ngày. Tỷ lệ đúng = tổng câu đúng / tổng câu đã trả lời, không phải điểm phát âm.</Text>
            <Pressable style={quizStyles.nextButton} disabled={!canQuiz} onPress={onQuiz}>
              <Text style={quizStyles.nextText}>{canQuiz ? '🎧 Làm bài nghe của ngày hiện tại' : 'Ngày này chưa đủ từ để tạo bài nghe'}</Text>
            </Pressable>
            <Pressable style={quizStyles.slowButton} onPress={onReview}>
              <Text style={quizStyles.slowText}>🎯 Mở kho từ nghe sai ({bank.length})</Text>
            </Pressable>
            <Text style={quizStyles.footer}>Thống kê chỉ sử dụng tối đa 100 lượt đã lưu trên điện thoại theo lịch sử hiện có. Ngày chưa có bài được hiển thị trống, không tính 0% độ chính xác. Không thay đổi điểm cũ, dữ liệu từ vựng hay SRS.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ListeningReviewBank({ onHome, onStart }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LISTENING_HISTORY_KEY).then(raw => {
      if (!active) return;
      const data = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(data) ? data : []);
    }).catch(() => { if (active) setError('Không đọc được lịch sử nghe. Hãy mở lại màn hình.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const bank = useMemo(() => listeningReviewBank(history), [history]);
  const [accent, setAccent] = useState('en-US');
  useEffect(() => () => { Speech.stop().catch(() => {}); }, []);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.learnHeader}>
        <Pressable onPress={onHome}><Text style={styles.backButton}>← Home</Text></Pressable>
        <Text style={styles.wordCounter}>LISTENING REVIEW</Text>
      </View>
      <ScrollView contentContainerStyle={quizStyles.screen}>
        <Text style={quizStyles.eyebrow}>🎯 LISTENING QUIZ 6.0</Text>
        <Text style={quizStyles.heading}>Kho từ nghe sai</Text>
        {loading ? <ActivityIndicator /> : error ? <Text style={quizStyles.error}>{error}</Text> : (
          <>
            <Text style={quizStyles.help}>Có {bank.length} từ cần luyện theo kết quả gần nhất. Từ đúng trong bài kiểm tra mới sẽ rời khỏi danh sách này.</Text>
            {bank.length > 0 && (
              <Pressable style={quizStyles.nextButton} onPress={() => onStart(bank.slice(0, 10))}>
                <Text style={quizStyles.nextText}>▶ Luyện nghe {Math.min(10, bank.length)} từ</Text>
              </Pressable>
            )}
            {bank.length === 0 ?
              <Text style={quizStyles.historyCard}>Chưa có từ nghe sai cần ôn. Hãy hoàn thành Listening Quiz để tạo dữ liệu.</Text> :
              bank.map(item => (
                <View key={String(item.id)} style={quizStyles.historyCard}>
                  <Text style={quizStyles.historyTitle}>{item.word}</Text>
                  <Text style={quizStyles.help}>{item.meaning}</Text>
                  <Text style={quizStyles.historyWord}>Sai {item.wrongCount} lượt · Gần nhất: {item.lastWrong || 'chưa rõ ngày'}</Text>
                  <Pressable onPress={() => Speech.stop().then(() => Speech.speak(item.word, { language: accent, rate: 0.85 })).catch(() => {})}>
                    <Text style={quizStyles.relisten}>🔊 Nghe lại</Text>
                  </Pressable>
                </View>
              ))}
            {bank.length > 0 && (
              <View style={quizStyles.accentRow}>
                {['en-US', 'en-GB'].map(locale => (
                  <Pressable key={locale} onPress={() => setAccent(locale)} style={[quizStyles.accent, accent === locale && quizStyles.accentActive]}>
                    <Text style={quizStyles.accentText}>{locale === 'en-US' ? '🇺🇸 Anh–Mỹ' : '🇬🇧 Anh–Anh'}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
        <Text style={quizStyles.footer}>Dữ liệu đọc từ lịch sử cũ (tối đa 100 lượt). Với bản 5.0, chỉ từ trả lời sai có kết quả chi tiết; từ đã đúng trước khi cập nhật không thể khôi phục chính xác. Không thay đổi SRS.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ListeningHistory({ onHome }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LISTENING_HISTORY_KEY)
      .then(raw => {
        if (!active) return;
        const data = raw ? JSON.parse(raw) : [];
        setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (active) setError('Không đọc được lịch sử. Vui lòng thử mở lại.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.learnHeader}>
        <Pressable onPress={onHome}><Text style={styles.backButton}>← Home</Text></Pressable>
        <Text style={styles.wordCounter}>LISTENING HISTORY</Text>
      </View>
      <ScrollView contentContainerStyle={quizStyles.screen}>
        <Text style={quizStyles.eyebrow}>📊 LISTENING QUIZ 5.0</Text>
        <Text style={quizStyles.heading}>Lịch sử kiểm tra nghe</Text>
        {loading ? <ActivityIndicator /> : error ? <Text style={quizStyles.error}>{error}</Text> :
          rows.length === 0 ? <Text style={quizStyles.help}>Chưa có bài kiểm tra hoàn thành. Hãy làm một bài Listening Quiz.</Text> :
          rows.map((item, idx) => (
            <View key={`${item.id || idx}`} style={quizStyles.historyCard}>
              <Text style={quizStyles.historyTitle}>
                Day {item.day} · {item.mode === 'retry' || item.mode === 'review' ? 'Ôn từ sai' : 'Bài kiểm tra'}
              </Text>
              <Text style={quizStyles.historyScore}>{item.correct}/{item.total} · {item.total ? Math.round(item.correct * 100 / item.total) : 0}%</Text>
              <Text style={quizStyles.help}>{item.date} · {item.time || ''}</Text>
              {Array.isArray(item.mistakes) && item.mistakes.length > 0 && (
                <View style={quizStyles.historyMistakes}>
                  <Text style={quizStyles.prompt}>Từ đã trả lời sai:</Text>
                  {item.mistakes.map((word, wi) => (
                    <Text key={`${word.id}-${wi}`} style={quizStyles.historyWord}>• {word.word} — {word.meaning}</Text>
                  ))}
                </View>
              )}
            </View>
          ))}
        <Text style={quizStyles.footer}>Lưu tối đa 100 lượt trên thiết bị. Lịch sử kiểm tra nghe không làm thay đổi SRS hay lịch sử luyện nói.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ListeningQuiz({ day, words, onHome, initialMode = 'full' }) {
  const [questions, setQuestions] = useState(() => makeListeningQuestions(words));
  const [mode, setMode] = useState(initialMode);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakes, setMistakes] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [finished, setFinished] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const savingRef = useRef(false);
  const [audioError, setAudioError] = useState('');
  const [accent, setAccent] = useState('en-US');
  const question = questions[index];
  const total = questions.length;

  useEffect(() => {
    return () => { Speech.stop().catch(() => {}); };
  }, []);

  function playWord(rate = 0.9) {
    if (!question) return;
    setAudioError('');
    Speech.stop().then(() => {
      Speech.speak(question.word, {
        language: accent,
        rate,
        onError: () => setAudioError('Không phát được âm thanh. Hãy kiểm tra âm lượng và thử lại.'),
      });
    }).catch(() => setAudioError('Không phát được âm thanh. Hãy thử lại.'));
  }

  function selectOption(option) {
    if (!question || selected !== null) return;
    setSelected(option);
    setAnswers(old => [...old, { id: question.id, word: question.word, meaning: question.meaning, correct: option === question.meaning.trim() }]);
    if (option === question.meaning.trim()) setCorrectCount(value => value + 1);
    else setMistakes(old => [...old, question]);
  }

  function saveCompletedQuiz() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveStatus('saving');
    const now = new Date();
    const entry = {
      id: `${now.getTime()}-${day}-${mode}`,
      day, date: localDateKey(now), time: now.toLocaleTimeString('vi-VN'),
      mode, total, correct: correctCount,
      mistakes: mistakes.map(({ id, word, meaning }) => ({ id, word, meaning })),
      answers,
    };
    saveListeningResult(entry).then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'));
  }

  function nextQuestion() {
    Speech.stop().catch(() => {});
    if (index + 1 >= total) {
      setFinished(true);
      saveCompletedQuiz();
    } else {
      setIndex(old => old + 1);
      setSelected(null);
      setAudioError('');
    }
  }

  function startRound(source, nextMode) {
    Speech.stop().catch(() => {});
    setQuestions(makeListeningQuestions(source));
    setMode(nextMode);
    setIndex(0);
    setSelected(null);
    setCorrectCount(0);
    setMistakes([]);
    setAnswers([]);
    setFinished(false);
    setSaveStatus('');
    savingRef.current = false;
    setAudioError('');
  }

  const answered = selected !== null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.learnHeader}>
        <Pressable onPress={() => { Speech.stop().catch(() => {}); onHome(); }}>
          <Text style={styles.backButton}>← Home</Text>
        </Pressable>
        <Text style={styles.wordCounter}>DAY {day} · LISTENING</Text>
      </View>
      <ScrollView contentContainerStyle={quizStyles.screen}>
        <Text style={quizStyles.eyebrow}>🎧 LISTENING QUIZ 5.0</Text>
        <Text style={quizStyles.heading}>{mode === 'retry' || mode === 'review' ? 'Luyện lại từ nghe sai' : 'Nghe và chọn nghĩa đúng'}</Text>
        {!finished && question ? (
          <>
            <Text style={quizStyles.counter}>Câu {index + 1}/{total} · Đúng {correctCount}</Text>
            <View style={quizStyles.track}>
              <View style={[quizStyles.fill, { width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }]} />
            </View>
            <View style={quizStyles.listenCard}>
              <Text style={quizStyles.label}>NGHE TRƯỚC KHI CHỌN</Text>
              <Text style={quizStyles.help}>Nhấn loa, nghe từ/cụm từ tiếng Anh và chọn nghĩa tiếng Việt.</Text>
              <View style={quizStyles.accentRow}>
                {['en-US', 'en-GB'].map(locale => (
                  <Pressable key={locale}
                    style={[quizStyles.accent, accent === locale && quizStyles.accentActive]}
                    onPress={() => setAccent(locale)}>
                    <Text style={quizStyles.accentText}>{locale === 'en-US' ? '🇺🇸 Anh–Mỹ' : '🇬🇧 Anh–Anh'}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={quizStyles.listenButton} onPress={() => playWord()}>
                <Text style={quizStyles.listenText}>🔊 Nghe câu hỏi</Text>
              </Pressable>
              <Pressable style={quizStyles.slowButton} onPress={() => playWord(0.7)}>
                <Text style={quizStyles.slowText}>🐢 Nghe chậm</Text>
              </Pressable>
              {!!audioError && <Text style={quizStyles.error}>{audioError}</Text>}
            </View>
            <Text style={quizStyles.prompt}>Chọn một nghĩa đúng:</Text>
            {question.options.map((option, choiceIndex) => {
              const correct = option === question.meaning.trim();
              const wrongSelected = answered && option === selected && !correct;
              return (
                <Pressable key={`${question.id}-${choiceIndex}`}
                  disabled={answered}
                  onPress={() => selectOption(option)}
                  style={[quizStyles.option, answered && correct && quizStyles.optionCorrect,
                    wrongSelected && quizStyles.optionWrong]}>
                  <Text style={quizStyles.optionText}>
                    {String.fromCharCode(65 + choiceIndex)}. {option}
                    {answered && correct ? '  ✓' : wrongSelected ? '  ✕' : ''}
                  </Text>
                </Pressable>
              );
            })}
            {answered && (
              <View style={quizStyles.feedback}>
                <Text style={quizStyles.feedbackTitle}>
                  {selected === question.meaning.trim() ? '✓ Chính xác!' : 'Chưa đúng – đây là đáp án đúng:'}
                </Text>
                <Text style={quizStyles.answer}>{question.word} — {question.meaning}</Text>
                <Pressable style={quizStyles.nextButton} onPress={nextQuestion}>
                  <Text style={quizStyles.nextText}>
                    {index + 1 === total ? 'Xem kết quả →' : 'Câu tiếp theo →'}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <View style={quizStyles.result}>
            <Text style={quizStyles.resultTitle}>Hoàn thành bài kiểm tra!</Text>
            <Text style={quizStyles.resultScore}>{correctCount}/{total}</Text>
            <Text style={quizStyles.help}>{total ? Math.round(correctCount * 100 / total) : 0}% câu trả lời đúng · {mode === 'retry' || mode === 'review' ? 'Lượt luyện từ sai' : `Day ${day}`}</Text>
            <Text style={quizStyles.saveStatus}>
              {saveStatus === 'saved' ? '✓ Đã lưu kết quả trên điện thoại.' :
               saveStatus === 'saving' ? 'Đang lưu kết quả…' :
               saveStatus === 'error' ? 'Không lưu được kết quả. Kiểm tra dung lượng rồi thử lưu lại.' : ''}
            </Text>
            {saveStatus === 'error' && (
              <Pressable style={quizStyles.slowButton} onPress={() => { savingRef.current = false; saveCompletedQuiz(); }}>
                <Text style={quizStyles.slowText}>↻ Thử lưu lại</Text>
              </Pressable>
            )}
            {mistakes.length > 0 ? (
              <>
                <Text style={quizStyles.prompt}>Các từ cần nghe lại ({mistakes.length}):</Text>
                {mistakes.map(item => (
                  <View style={quizStyles.mistake} key={item.id}>
                    <Text style={quizStyles.mistakeWord}>{item.word}</Text>
                    <Text style={quizStyles.help}>{item.meaning}</Text>
                    <Pressable onPress={() => Speech.stop().then(() => Speech.speak(item.word, { language: accent, rate: 0.85 })).catch(() => {})}>
                      <Text style={quizStyles.relisten}>🔊 Nghe lại</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable style={quizStyles.nextButton}
                  disabled={saveStatus === 'saving' || saveStatus === 'error'}
                  onPress={() => startRound(mistakes, 'retry')}>
                  <Text style={quizStyles.nextText}>↻ Luyện lại {mistakes.length} từ trả lời sai</Text>
                </Pressable>
              </>
            ) : <Text style={quizStyles.help}>Bạn đã trả lời đúng tất cả câu hỏi trong lượt này.</Text>}
            <Pressable style={quizStyles.nextButton}
              disabled={saveStatus === 'saving' || saveStatus === 'error'}
              onPress={() => startRound(words, 'full')}>
              <Text style={quizStyles.nextText}>↻ Làm bài kiểm tra mới</Text>
            </Pressable>
            <Pressable style={quizStyles.homeReturn} onPress={onHome}>
              <Text style={quizStyles.homeReturnText}>← Về Home</Text>
            </Pressable>
          </View>
        )}
        <Text style={quizStyles.footer}>
          Kết quả bài hoàn thành được lưu riêng bằng AsyncStorage. Bài nghe không thay đổi tiến độ SRS hay lịch sử luyện nói.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PronunciationPanel({ word, example, showExample, practiceMode = false, onRecorded, canPrev, canNext, onPrev, onNext, onFinish }) {
  const [accent, setAccent] = useState('en-US');
  const [ipa, setIpa] = useState('');
  const [ipaState, setIpaState] = useState('loading');
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordError, setRecordError] = useState('');
  const [recordBusy, setRecordBusy] = useState(false);
  const recordingRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const playerState = useAudioPlayerStatus(player);

  // expo-audio owns the useAudioPlayer lifecycle. The native player may
  // already be released when this panel unmounts (e.g. Back to Home).
  function pausePlaybackIfAvailable() {
    try {
      player.pause();
    } catch (_) {
      // Ignore a player that Expo has already released.
    }
  }

  useEffect(() => {
    let active = true;
    const target = (word || '').trim();
    const key = target.toLowerCase();

    setIpa('');
    setIpaState('loading');
    setSpeechError('');

    // The dictionary API is word-oriented; don't display misleading
    // transcriptions for entire phrases/sentences.
    if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(target)) {
      setIpaState('phrase');
      return () => { active = false; };
    }

    if (phoneticCache.has(key)) {
      const cached = phoneticCache.get(key);
      setIpa(cached);
      setIpaState(cached ? 'ready' : 'unavailable');
      return () => { active = false; };
    }

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(target)}`)
      .then((response) => {
        if (!response.ok) throw new Error('No dictionary entry');
        return response.json();
      })
      .then((entries) => {
        const entry = Array.isArray(entries) ? entries[0] : null;
        const candidate =
          (entry?.phonetics || []).find((p) => typeof p.text === 'string' && p.text.trim())?.text ||
          entry?.phonetic ||
          '';
        const result = String(candidate).trim();
        phoneticCache.set(key, result);
        if (active) {
          setIpa(result);
          setIpaState(result ? 'ready' : 'unavailable');
        }
      })
      .catch(() => {
        // Don't cache network errors: retry upon returning to the card.
        if (active) setIpaState('unavailable');
      });

    return () => { active = false; };
  }, [word]);

  useEffect(() => {
    // Never let the previous flashcard keep speaking.
    return () => { Speech.stop().catch(() => {}); };
  }, [word]);

  async function speak(text, rate = 0.95) {
    if (!text?.trim() || recorderState.isRecording || recordBusy) return;
    pausePlaybackIfAvailable();
    setSpeechError('');
    try {
      await Speech.stop(); // Clears the previous utterance queue.
      setSpeaking(true);
      Speech.speak(text, {
        language: accent,
        rate,
        pitch: 1,
        onDone: () => setSpeaking(false),
        onStopped: () => setSpeaking(false),
        onError: () => {
          setSpeaking(false);
          setSpeechError('Không thể phát âm thanh. Kiểm tra âm lượng và giọng đọc trên điện thoại.');
        },
      });
    } catch (error) {
      setSpeaking(false);
      setSpeechError('Không thể phát âm thanh. Hãy thử lại trên điện thoại.');
    }
  }

  async function stopSpeaking() {
    try {
      await Speech.stop();
    } finally {
      setSpeaking(false);
    }
  }

  async function startRecording() {
    if (recordBusy || recordingRef.current) return;
    setRecordBusy(true);
    setRecordError('');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Cần quyền micro', 'Hãy cho phép Expo Go truy cập micro trong cài đặt điện thoại để luyện phát âm.');
        return;
      }
      await Speech.stop();
      setSpeaking(false);
      pausePlaybackIfAvailable();
      // The previous take is replaced only after a successful new recording.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
    } catch (error) {
      setRecordError('Không thể bắt đầu ghi âm. Hãy kiểm tra quyền micro và thử lại.');
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    } finally {
      setRecordBusy(false);
    }
  }

  async function stopRecording() {
    if (recordBusy || !recordingRef.current) return;
    setRecordBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording URI unavailable');
      setRecordedUri(uri);
      setRecordError('');
      if (onRecorded) onRecorded();
    } catch (error) {
      setRecordError('Không lưu được bản ghi. Hãy thử ghi âm lại.');
    } finally {
      recordingRef.current = false;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setRecordBusy(false);
    }
  }

  async function playRecording() {
    if (!recordedUri || recordBusy || recorderState.isRecording) return;
    setRecordError('');
    try {
      await Speech.stop();
      setSpeaking(false);
      if (playerState.playing) pausePlaybackIfAvailable();
      // Replacing the source starts this recording at the beginning.
      player.replace(recordedUri);
      player.play();
    } catch (error) {
      setRecordError('Không phát được bản ghi. Hãy ghi âm lại và thử lần nữa.');
    }
  }

  useEffect(() => {
    return () => {
      // Do not call player.pause() here: useAudioPlayer automatically releases
      // its native object on unmount, so pause() can crash after release.
      if (recordingRef.current) {
        recorder.stop().catch(() => {});
        recordingRef.current = false;
      }
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [recorder, player]);

  return (
    <View style={styles.pronunciationPanel}>
      <Text style={styles.pronunciationTitle}>🔊 SOUND & PRONUNCIATION</Text>
      <Text style={styles.pronunciationIpa}>
        {ipaState === 'ready'
          ? `IPA: ${ipa}`
          : ipaState === 'loading'
            ? 'Đang tải phiên âm IPA…'
            : ipaState === 'phrase'
              ? 'Cụm từ/câu: nghe phát âm đầy đủ bằng nút bên dưới.'
              : 'Chưa có IPA cho từ này (cần Internet để tra từ điển).'}
      </Text>

      <View style={styles.accentRow}>
        <Pressable
          style={[styles.accentButton, accent === 'en-US' && styles.accentSelected]}
          onPress={() => { stopSpeaking(); setAccent('en-US'); }}
        >
          <Text style={[styles.accentText, accent === 'en-US' && styles.accentSelectedText]}>
            🇺🇸 Anh–Mỹ
          </Text>
        </Pressable>
        <Pressable
          style={[styles.accentButton, accent === 'en-GB' && styles.accentSelected]}
          onPress={() => { stopSpeaking(); setAccent('en-GB'); }}
        >
          <Text style={[styles.accentText, accent === 'en-GB' && styles.accentSelectedText]}>
            🇬🇧 Anh–Anh
          </Text>
        </Pressable>
      </View>

      <View style={styles.speechRow}>
        <Pressable style={styles.speechButton} onPress={() => speak(word)}>
          <Text style={styles.speechButtonText}>▶ Nghe từ/cụm từ</Text>
        </Pressable>
        <Pressable style={styles.slowButton} onPress={() => speak(word, 0.7)}>
          <Text style={styles.slowButtonText}>🐢 Nghe chậm</Text>
        </Pressable>
      </View>
      {showExample && Boolean(example) && (
        <Pressable style={styles.exampleSpeechButton} onPress={() => speak(example, 0.9)}>
          <Text style={styles.exampleSpeechText}>▶ Nghe câu ví dụ</Text>
        </Pressable>
      )}
      {speaking && (
        <Pressable onPress={stopSpeaking}>
          <Text style={styles.stopSpeechText}>■ Dừng phát âm</Text>
        </Pressable>
      )}
      {Boolean(speechError) && <Text style={styles.speechError}>{speechError}</Text>}

      <View style={styles.speakingPractice}>
        <Text style={styles.speakingTitle}>🎤 {practiceMode ? 'LUYỆN PHÁT ÂM TỪ NÀY' : 'SPEAKING PRACTICE'}</Text>
        <Text style={styles.speakingHelp}>
          1. Nghe mẫu · 2. Thu giọng của bạn · 3. Nghe lại và so sánh.
        </Text>
        <Pressable
          style={[styles.recordButton, recordBusy && styles.recordButtonDisabled]}
          disabled={recordBusy}
          onPress={recorderState.isRecording ? stopRecording : startRecording}
        >
          <Text style={styles.recordButtonText}>
            {recordBusy ? 'Đang xử lý…' : recorderState.isRecording ? '■ Dừng ghi âm' : '🎤 Bắt đầu ghi âm'}
          </Text>
        </Pressable>
        {recorderState.isRecording && (
          <Text style={styles.recordingIndicator}>
            ● Đang ghi âm · {Math.floor(recorderState.durationMillis / 1000)} giây
          </Text>
        )}
        {recordedUri && !recorderState.isRecording && (
          <Pressable
            style={[styles.replayButton, recordBusy && styles.recordButtonDisabled]}
            disabled={recordBusy}
            onPress={playRecording}
          >
            <Text style={styles.replayButtonText}>▶ Nghe lại giọng của tôi</Text>
          </Pressable>
        )}
        {Boolean(recordError) && <Text style={styles.speechError}>{recordError}</Text>}
        {practiceMode && (
          <View style={styles.practiceNav}>
            <Pressable
              style={[styles.practiceNavButton, (!canPrev || recorderState.isRecording || recordBusy) && styles.recordButtonDisabled]}
              disabled={!canPrev || recorderState.isRecording || recordBusy}
              onPress={onPrev}
            >
              <Text style={styles.practiceNavText}>← Từ trước</Text>
            </Pressable>
            <Pressable
              style={[styles.practiceNavButton, (recorderState.isRecording || recordBusy) && styles.recordButtonDisabled]}
              disabled={recorderState.isRecording || recordBusy}
              onPress={canNext ? onNext : onFinish}
            >
              <Text style={styles.practiceNavText}>{canNext ? 'Từ tiếp →' : 'Hoàn tất ✓'}</Text>
            </Pressable>
          </View>
        )}
        <Text style={styles.speakingNote}>
          Bấm “Bắt đầu ghi âm” lần nữa để luyện lại. Bản ghi chỉ lưu tạm trên thiết bị;
          ghi lần mới sẽ thay bản cũ. Chưa có chức năng tự chấm điểm phát âm.
        </Text>
      </View>
      <Text style={styles.speechHint}>
        Nghe → nhắc lại thành tiếng → nghe chậm → tự so sánh.
        Giọng đọc phụ thuộc vào giọng tiếng Anh đã cài trên thiết bị.
      </Text>
    </View>
  );
}

// ===============================
// STYLES
// ===============================

const styles =
  StyleSheet.create({

    container: {
      flex: 1,
      backgroundColor:
        '#F5F7FB',
    },


    loadingContainer: {
      flex: 1,
      backgroundColor:
        '#F5F7FB',
      justifyContent:
        'center',
      alignItems:
        'center',
      padding: 24,
    },


    loadingTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: '#182033',
      marginTop: 15,
      textAlign: 'center',
    },


    loadingText: {
      marginTop: 8,
      fontSize: 14,
      color: '#80869A',
    },


    // 30 DAY PLAN HEADER
    // paddingTop increased for phone

    topHeader: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },


    headerTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: '#182033',
    },


    headerSpacer: {
      width: 55,
    },


    homeContainer: {
      padding: 24,
      paddingBottom: 50,
    },


    appName: {
      fontSize: 28,
      fontWeight: '800',
      textAlign: 'center',
      marginTop: 15,
      color: '#182033',
    },


    challenge: {
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 5,
      color: '#687089',
      letterSpacing: 2,
    },


    dayBox: {
      marginTop: 30,
      backgroundColor:
        '#E8EEFF',
      borderRadius: 18,
      padding: 20,
      alignItems: 'center',
    },


    daySmall: {
      fontSize: 11,
      fontWeight: '700',
      color: '#65749A',
    },


    dayBig: {
      marginTop: 5,
      fontSize: 28,
      fontWeight: '800',
      color: '#304FFE',
    },


    topicText: {
      marginTop: 4,
      fontSize: 14,
      fontWeight: '600',
      color: '#65749A',
      textAlign: 'center',
    },


    // NEW WORDS + REVIEW DUE

    todayGrid: {
      flexDirection: 'row',
      marginTop: 16,
    },


    todaySpacer: {
      width: 12,
    },


    todayCard: {
      flex: 1,
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 20,
      alignItems: 'center',
    },


    todayNumber: {
      fontSize: 30,
      fontWeight: '800',
      color: '#182033',
    },


    todayLabel: {
      marginTop: 5,
      fontSize: 13,
      color: '#80869A',
      textAlign: 'center',
    },


    progressCard: {
      backgroundColor:
        '#FFFFFF',
      padding: 20,
      borderRadius: 18,
      marginTop: 16,
    },


    overallMiniCard: {
      backgroundColor:
        '#FFFFFF',
      padding: 20,
      borderRadius: 18,
      marginTop: 16,
    },


    rowBetween: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
    },


    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: '#182033',
    },


    progressNumber: {
      fontSize: 16,
      fontWeight: '700',
      color: '#304FFE',
    },


    progressBackground: {
      height: 12,
      backgroundColor:
        '#E8EBF2',
      borderRadius: 10,
      marginTop: 18,
      overflow: 'hidden',
    },


    progressBar: {
      height: '100%',
      backgroundColor:
        '#304FFE',
      borderRadius: 10,
    },


    percentText: {
      marginTop: 10,
      color: '#80869A',
      fontSize: 13,
    },


    // LEARN BUTTON

    startButton: {
      marginTop: 22,
      backgroundColor:
        '#304FFE',
      borderRadius: 16,
      paddingVertical: 19,
      paddingHorizontal: 20,
    },


    startButtonText: {
      textAlign: 'center',
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '800',
    },


    disabledButton: {
      backgroundColor:
        '#AEB8E8',
    },


    // REVIEW BUTTON

    reviewButton: {
      marginTop: 12,
      backgroundColor:
        '#E5F8EB',
      borderRadius: 16,
      paddingVertical: 18,
      borderWidth: 1.5,
      borderColor:
        '#45A565',
    },


    reviewButtonText: {
      textAlign: 'center',
      color: '#2F8A4D',
      fontSize: 15,
      fontWeight: '800',
    },


    disabledReviewButton: {
      backgroundColor:
        '#F1F3F7',
      borderColor:
        '#D8DCE6',
    },


    disabledReviewText: {
      color: '#9AA0B1',
    },


    // 30 DAY PLAN BUTTON

    planButton: {
      marginTop: 12,
      borderWidth: 1.5,
      borderColor:
        '#304FFE',
      borderRadius: 16,
      paddingVertical: 16,
    },


    planButtonText: {
      textAlign: 'center',
      color: '#304FFE',
      fontSize: 14,
      fontWeight: '800',
    },


    todayTitle: {
      marginTop: 30,
      fontSize: 17,
      fontWeight: '700',
      color: '#182033',
    },


    ratingSummary: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      marginTop: 12,
      paddingVertical: 20,
      paddingHorizontal: 15,
      flexDirection: 'row',
      justifyContent:
        'space-around',
    },


    ratingNumber: {
      textAlign: 'center',
      fontSize: 22,
      fontWeight: '800',
      color: '#182033',
    },


    ratingText: {
      marginTop: 3,
      color: '#80869A',
      fontSize: 12,
      textAlign: 'center',
    },


    // SRS INFORMATION

    srsInfoCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      marginTop: 16,
      padding: 18,
    },


    srsInfoTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: '#182033',
      marginBottom: 8,
    },


    srsInfoText: {
      fontSize: 13,
      color: '#687089',
      marginTop: 4,
    },


    srsNote: {
      fontSize: 12,
      color: '#9AA0B1',
      marginTop: 9,
      fontStyle: 'italic',
    },


    resetButton: {
      padding: 16,
      marginTop: 8,
    },


    resetText: {
      textAlign: 'center',
      color: '#8A8FA0',
      fontSize: 13,
    },


    // IMPORTANT:
    // HOME BUTTON LOWER ON PHONE

    learnHeader: {
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },


    backButton: {
      paddingVertical: 12,
      paddingHorizontal: 8,
      minHeight: 48,
      textAlignVertical: 'center',
      fontSize: 16,
      fontWeight: '700',
      color: '#304FFE',
    },


    wordCounter: {
      fontSize: 14,
      fontWeight: '600',
      color: '#687089',
    },


    learnContainer: {
      paddingHorizontal: 22,
      paddingBottom: 40,
      paddingTop: 10,
    },


    // NEW / REVIEW BADGE

    sessionBadge: {
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor:
        '#E8EEFF',
      marginBottom: 12,
    },


    sessionBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: '#304FFE',
      letterSpacing: 1,
    },


    reviewSessionBadge: {
      backgroundColor:
        '#E5F8EB',
    },


    reviewSessionBadgeText: {
      color: '#2F8A4D',
    },


    topic: {
      textAlign: 'center',
      fontSize: 13,
      fontWeight: '700',
      color: '#304FFE',
      textTransform:
        'uppercase',
      letterSpacing: 1.2,
      marginBottom: 12,
    },


    flashcard: {
      backgroundColor:
        '#FFFFFF',
      minHeight: 390,
      borderRadius: 25,
      paddingHorizontal: 28,
      paddingVertical: 32,
      justifyContent:
        'center',
      shadowColor:
        '#000000',
      shadowOpacity: 0.08,
      shadowRadius: 15,
      shadowOffset: {
        width: 0,
        height: 5,
      },
      elevation: 4,
    },


    word: {
      fontSize: 32,
      fontWeight: '800',
      textAlign: 'center',
      color: '#182033',
      marginBottom: 30,
    },


    tapText: {
      textAlign: 'center',
      fontSize: 15,
      color: '#8A8FA0',
    },


    questionMark: {
      marginTop: 20,
      textAlign: 'center',
      fontSize: 44,
      fontWeight: '300',
      color: '#D4D8E3',
    },


    meaning: {
      textAlign: 'center',
      fontSize: 22,
      fontWeight: '700',
      color: '#304FFE',
      lineHeight: 30,
    },


    divider: {
      height: 1,
      backgroundColor:
        '#E8EBF2',
      marginVertical: 24,
    },


    exampleLabel: {
      textAlign: 'center',
      fontSize: 11,
      fontWeight: '800',
      color: '#9AA0B1',
      letterSpacing: 1.5,
    },


    example: {
      textAlign: 'center',
      marginTop: 10,
      fontSize: 17,
      lineHeight: 25,
      color: '#303849',
    },


    exampleVi: {
      textAlign: 'center',
      marginTop: 10,
      fontSize: 14,
      lineHeight: 21,
      color: '#8A8FA0',
    },


    instruction: {
      textAlign: 'center',
      marginTop: 20,
      color: '#8A8FA0',
      fontSize: 13,
    },


    ratingQuestion: {
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '600',
      color: '#687089',
      marginTop: 20,
      marginBottom: 12,
    },


    ratingButtons: {
      flexDirection: 'row',
    },


    ratingButton: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: 12,
      alignItems: 'center',
      marginHorizontal: 3,
    },


    againButton: {
      backgroundColor:
        '#FFE8E8',
    },


    hardButton: {
      backgroundColor:
        '#FFF0D9',
    },


    goodButton: {
      backgroundColor:
        '#E7F1FF',
    },


    easyButton: {
      backgroundColor:
        '#E5F8EB',
    },


    ratingButtonText: {
      fontSize: 11,
      fontWeight: '800',
      color: '#303849',
    },


    ratingButtonSmall: {
      marginTop: 3,
      fontSize: 9.5,
      color: '#687089',
      textAlign: 'center',
    },


    // DAY LIST

    daysContainer: {
      padding: 20,
      paddingBottom: 50,
    },


    overallCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 20,
      marginBottom: 16,
    },


    overallTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: '#687089',
    },


    overallNumber: {
      marginTop: 5,
      fontSize: 28,
      fontWeight: '800',
      color: '#182033',
    },


    dayCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor:
        'transparent',
    },


    selectedDayCard: {
      borderColor:
        '#304FFE',
      backgroundColor:
        '#F4F6FF',
    },


    dayBadge: {
      width: 55,
      height: 55,
      borderRadius: 14,
      backgroundColor:
        '#E8EEFF',
      alignItems: 'center',
      justifyContent:
        'center',
    },


    dayBadgeSmall: {
      fontSize: 9,
      fontWeight: '700',
      color: '#65749A',
    },


    dayBadgeNumber: {
      fontSize: 22,
      fontWeight: '800',
      color: '#304FFE',
    },


    dayInfo: {
      flex: 1,
      marginLeft: 13,
    },


    dayTopic: {
      fontSize: 15,
      fontWeight: '800',
      color: '#182033',
    },


    dayMeta: {
      marginTop: 3,
      fontSize: 12,
      color: '#80869A',
    },


    miniProgressBackground: {
      height: 6,
      backgroundColor:
        '#E8EBF2',
      borderRadius: 5,
      marginTop: 8,
      overflow: 'hidden',
    },


    miniProgressBar: {
      height: '100%',
      backgroundColor:
        '#304FFE',
      borderRadius: 5,
    },


    reviewText: {
      marginTop: 6,
      fontSize: 10.5,
      color: '#9AA0B1',
    },


    dayPercent: {
      marginLeft: 10,
      fontSize: 12,
      fontWeight: '800',
      color: '#304FFE',
    },


    pronunciationPanel: {
      backgroundColor: '#FFFFFF',
      borderRadius: 18,
      padding: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: '#DCE6FF',
      width: '100%',
    },
    pronunciationTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: '#304FFE',
      marginBottom: 8,
    },
    pronunciationIpa: {
      fontSize: 15,
      color: '#263246',
      marginBottom: 12,
      lineHeight: 23,
    },
    accentRow: {
      flexDirection: 'row',
      marginBottom: 12,
    },
    accentButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: '#F0F3FA',
      alignItems: 'center',
      marginHorizontal: 3,
    },
    accentSelected: {
      backgroundColor: '#304FFE',
    },
    accentText: {
      color: '#34425D',
      fontWeight: '700',
      fontSize: 12,
    },
    accentSelectedText: {
      color: '#FFFFFF',
    },
    speechRow: {
      flexDirection: 'row',
      marginBottom: 8,
    },
    speechButton: {
      flex: 1.3,
      backgroundColor: '#304FFE',
      paddingVertical: 13,
      borderRadius: 10,
      alignItems: 'center',
      marginRight: 7,
    },
    speechButtonText: {
      color: '#FFFFFF',
      fontWeight: '800',
      fontSize: 12,
    },
    slowButton: {
      flex: 1,
      backgroundColor: '#E8EEFF',
      paddingVertical: 13,
      borderRadius: 10,
      alignItems: 'center',
    },
    slowButtonText: {
      color: '#304FFE',
      fontWeight: '800',
      fontSize: 12,
    },
    exampleSpeechButton: {
      backgroundColor: '#E8F7EF',
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
      marginBottom: 8,
    },
    exampleSpeechText: {
      color: '#167345',
      fontWeight: '800',
      fontSize: 12,
    },
    stopSpeechText: {
      color: '#B73C3C',
      textAlign: 'center',
      fontWeight: '700',
      paddingVertical: 8,
    },
    speechError: {
      color: '#B73C3C',
      fontSize: 12,
      marginTop: 4,
    },
    speakingPractice: {
      marginTop: 12,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: '#DCE6FF',
    },
    speakingTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: '#167345',
      marginBottom: 8,
    },
    speakingHelp: {
      fontSize: 12,
      color: '#34425D',
      lineHeight: 19,
      marginBottom: 10,
    },
    recordButton: {
      backgroundColor: '#C43848',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 8,
    },
    recordButtonDisabled: {
      opacity: 0.55,
    },
    recordButtonText: {
      fontSize: 13,
      color: '#FFFFFF',
      fontWeight: '800',
    },
    recordingIndicator: {
      color: '#C43848',
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 10,
    },
    replayButton: {
      backgroundColor: '#E8F7EF',
      paddingVertical: 13,
      borderRadius: 10,
      alignItems: 'center',
      marginBottom: 8,
    },
    replayButtonText: {
      color: '#167345',
      fontWeight: '800',
      fontSize: 12,
    },
    speakingNote: {
      color: '#748099',
      fontSize: 11,
      lineHeight: 17,
    },
    historyHomeButton: {
      backgroundColor: '#EDF3FF', borderColor: '#BACCF9', borderWidth: 1,
      padding: 17, borderRadius: 14, marginBottom: 13,
    },
    historyHomeTitle: { color: '#173A72', fontSize: 15, fontWeight: '800' },
    historyHeading: { fontSize: 24, fontWeight: '800', color: '#17345B', marginTop: 12, marginBottom: 14 },
    historySummary: { backgroundColor: '#E8F7EF', padding: 18, borderRadius: 14, marginBottom: 16 },
    historyBigNumber: { color: '#126B46', fontSize: 17, fontWeight: '800', marginBottom: 6 },
    historyRow: { backgroundColor: '#FFFFFF', borderColor: '#DFE8ED', borderWidth: 1,
      borderRadius: 11, padding: 15, marginBottom: 9, flexDirection: 'row', justifyContent: 'space-between' },
    historyDate: { color: '#34425D', fontSize: 13, fontWeight: '700' },
    historyNumber: { color: '#167345', fontSize: 13, fontWeight: '700' },
    practiceDayCount: { color: '#167345', fontSize: 12, fontWeight: '700', marginBottom: 9 },
    practiceHomeButton: {
      backgroundColor: '#E8F7EF', borderWidth: 1, borderColor: '#9FD7B6',
      padding: 17, borderRadius: 14, marginTop: 13, marginBottom: 13,
    },
    practiceHomeTitle: { color: '#126B46', fontSize: 15, fontWeight: '800' },
    practiceHomeSubtitle: { color: '#386B52', fontSize: 12, lineHeight: 18, marginTop: 5 },
    practiceScreen: { padding: 18, paddingBottom: 42 },
    practiceEyebrow: { color: '#167345', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    practiceProgressTitle: { color: '#233A58', fontSize: 14, fontWeight: '700', marginTop: 8, marginBottom: 9 },
    practiceTrack: { backgroundColor: '#DFE9E4', height: 9, borderRadius: 20, overflow: 'hidden', marginBottom: 18 },
    practiceFill: { backgroundColor: '#28A468', height: 9, borderRadius: 20 },
    practiceWordCard: { backgroundColor: '#FFFFFF', borderColor: '#DFE8ED', borderWidth: 1, borderRadius: 18, padding: 20, marginBottom: 15 },
    practiceTopic: { fontSize: 12, color: '#687D92', marginBottom: 8 },
    practiceWord: { fontSize: 27, color: '#17345B', fontWeight: '800', marginBottom: 7 },
    practiceMeaning: { fontSize: 17, color: '#167345', fontWeight: '700', marginBottom: 10 },
    practiceExample: { fontSize: 14, color: '#34425D', lineHeight: 21 },
    practiceExampleVi: { fontSize: 12, color: '#748099', lineHeight: 18, marginTop: 4 },
    practiceStatus: { color: '#167345', fontWeight: '700', marginTop: 14, fontSize: 12 },
    practiceNav: { flexDirection: 'row', gap: 10, marginTop: 9, marginBottom: 12 },
    practiceNavButton: { flex: 1, backgroundColor: '#E4EEFF', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    practiceNavText: { fontSize: 13, fontWeight: '800', color: '#173A72' },
    practiceFooter: { fontSize: 12, lineHeight: 19, color: '#687D92', marginTop: 17 },
    speechHint: {
      color: '#748099',
      fontSize: 11,
      lineHeight: 17,
      marginTop: 5,
    },
  });

// Styles riêng cho Listening Quiz, không sửa styles của màn học/ghi âm.
const quizStyles = StyleSheet.create({
  dashboardHomeButton: { backgroundColor: '#EBF5FF', borderWidth: 1, borderColor: '#BDD9F7', padding: 17, borderRadius: 14, marginBottom: 13 },
  dashboardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14 },
  dashboardTile: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 13, borderWidth: 1, borderColor: '#E2E8F5', padding: 14, marginBottom: 10 },
  dashboardNumber: { color: '#3159D9', fontSize: 28, fontWeight: '800' },
  dashboardCaption: { color: '#66758C', fontSize: 12, marginTop: 4 },
  dashboardDay: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F5', borderRadius: 12, padding: 12, marginBottom: 9 },
  dashboardDayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  reviewHomeButton: { backgroundColor: '#FFF4E5', borderWidth: 1, borderColor: '#F0CF91', padding: 17, borderRadius: 14, marginBottom: 13 },
  historyHomeButton: { backgroundColor: '#EDF7F6', borderWidth: 1, borderColor: '#B6E1D5', padding: 17, borderRadius: 14, marginTop: 0, marginBottom: 13 },
  homeButton: { backgroundColor: '#E9EEFF', borderWidth: 1, borderColor: '#B7C6F6', padding: 17, borderRadius: 14, marginTop: 13, marginBottom: 13 },
  homeTitle: { color: '#2145A5', fontSize: 15, fontWeight: '800' },
  homeSubtitle: { color: '#435B8B', fontSize: 12, lineHeight: 18, marginTop: 5 },
  screen: { padding: 18, paddingBottom: 48 },
  eyebrow: { color: '#284EC9', fontSize: 12, fontWeight: '800' },
  heading: { fontSize: 23, fontWeight: '800', color: '#17345B', marginTop: 8, marginBottom: 16 },
  counter: { color: '#34425D', fontWeight: '700', marginBottom: 9 },
  track: { backgroundColor: '#DEE6F5', height: 9, borderRadius: 12, overflow: 'hidden', marginBottom: 17 },
  fill: { backgroundColor: '#3159D9', height: 9, borderRadius: 12 },
  listenCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F5', borderRadius: 18, padding: 18, marginBottom: 18 },
  label: { color: '#687D92', fontSize: 11, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  help: { color: '#66758C', fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  accentRow: { flexDirection: 'row', gap: 8, marginTop: 15, marginBottom: 12 },
  accent: { flex: 1, backgroundColor: '#EFF2FA', borderRadius: 9, paddingVertical: 11, alignItems: 'center' },
  accentActive: { backgroundColor: '#DDE6FF', borderWidth: 1, borderColor: '#3159D9' },
  accentText: { fontSize: 12, color: '#2145A5', fontWeight: '700' },
  listenButton: { backgroundColor: '#3159D9', borderRadius: 11, paddingVertical: 16, alignItems: 'center' },
  listenText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  slowButton: { backgroundColor: '#E9EEFF', borderRadius: 11, paddingVertical: 12, marginTop: 8, alignItems: 'center' },
  slowText: { color: '#3159D9', fontWeight: '700' },
  error: { color: '#B42333', fontSize: 12, marginTop: 9 },
  prompt: { color: '#17345B', fontSize: 15, fontWeight: '800', marginBottom: 11, marginTop: 5 },
  option: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDE5EF', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 15, marginBottom: 10 },
  optionCorrect: { backgroundColor: '#E6F7EC', borderColor: '#39A46C', borderWidth: 2 },
  optionWrong: { backgroundColor: '#FFF0F1', borderColor: '#D24B59', borderWidth: 2 },
  optionText: { color: '#20344F', fontSize: 14, fontWeight: '600', lineHeight: 21 },
  feedback: { backgroundColor: '#F1F6FF', borderRadius: 14, padding: 16, marginTop: 8 },
  feedbackTitle: { color: '#2145A5', fontWeight: '800', fontSize: 15, marginBottom: 6 },
  answer: { color: '#17345B', fontSize: 15, lineHeight: 22, marginBottom: 14 },
  nextButton: { backgroundColor: '#3159D9', borderRadius: 11, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  nextText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  result: { backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: '#E2E8F5', padding: 18 },
  resultTitle: { color: '#17345B', fontSize: 20, textAlign: 'center', fontWeight: '800' },
  resultScore: { color: '#3159D9', fontSize: 44, textAlign: 'center', fontWeight: '800', marginTop: 10 },
  mistake: { backgroundColor: '#F4F7FF', borderRadius: 9, padding: 10, marginBottom: 8 },
  mistakeWord: { color: '#17345B', fontWeight: '800', fontSize: 14 },
  homeReturn: { padding: 15, alignItems: 'center', marginTop: 8 },
  homeReturnText: { color: '#3159D9', fontWeight: '800' },
  relisten: { color: '#3159D9', fontWeight: '800', marginTop: 10, paddingVertical: 5 },
  saveStatus: { color: '#28785D', fontWeight: '700', textAlign: 'center', marginTop: 12, marginBottom: 12 },
  historyCard: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F5', padding: 15, marginBottom: 12 },
  historyTitle: { color: '#17345B', fontWeight: '800', fontSize: 15 },
  historyScore: { color: '#3159D9', fontSize: 24, fontWeight: '800', marginTop: 6 },
  historyMistakes: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F5', paddingTop: 12 },
  historyWord: { color: '#34425D', fontSize: 13, lineHeight: 21 },
  footer: { color: '#748099', fontSize: 11, lineHeight: 18, marginTop: 22 },
});
