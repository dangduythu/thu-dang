# English Learning 15.0 — release notes and Android QA

## What changed (additive to V11)
- **Visual Vocabulary**: 10-word illustrated review with show/hide meaning; existing Wikimedia Commons lookup remains optional and online. A deterministic subject pictogram works offline. IPA lookup is available for single words when connected (word/phrase IPA is not fabricated).
- **Listening Master**: three new modes, listening-to-meaning, dictation, and sentence gap; US/UK speech and slow playback. New results are in `@technical_english_plus_history_v1` and do not overwrite the existing Listening Quiz history.
- **Speaking Coach**: retained the original audio recording/playback panel and history. Added manual **self-reflection** (OK/repeat) per word in the speaking screen. It is not automatic speech recognition or AI pronunciation scoring.
- **Smart Review 2.0**: review suggestions from old SRS due/Again/Hard, newer listening errors, and self-reflection. Viewing them does not change old SRS intervals.
- **Cloud backup** accepts and exports the two new optional keys, while still accepting old schema v1 backup files.
- Existing 1,000 vocabulary records, word IDs, existing storage keys, EAS project ID and Android application ID are unchanged.

## Explicit limitations
- Real-world photo matching is an online Commons search, not a verified one-to-one photo catalogue. The offline fallback is a bundled category pictogram, not an offline stock photo.
- No native speech-to-text or phoneme-level pronunciation score is shipped. Such a feature requires a selected recognizer/API and separate consent/security review.
- IPA requires network and is shown only for individual English words when returned by the dictionary provider.
- The older Listening Quiz/SRS storage is retained; the new Listening Master results use a separate namespace.

## Release identifiers
- Version: 15.0.0
- Android versionCode: 3 (V11 was 2; V10.5 was 1)
- Android application ID: com.englishlearning.personalapp
- Expo owner: dangduythus-team
- Expo project ID: 956b20e5-fa85-44da-889a-2dda2cdf10ec

## Before running EAS Build
1. Commit/choose branch `english-learning-v15`.
2. Open repository Actions → Build English Learning APK → Run workflow → choose `english-learning-v15`.
3. Workflow checks Expo Doctor and Android JS bundle BEFORE running EAS build; if either fails, check logs.
4. Download signed APK from the EAS build URL, install OVER existing application; do not uninstall.
5. Keep old app/data backed up while validating. A signing mismatch causes install rejection; do not uninstall to work around it.

## Phone checklist
- Existing day/progress, favourite words, quiz and speaking history are still present.
- Home/back/edge-swipe navigation works; Home asks before exit.
- Hub → Learning Studio loads Visual, three Listening Master modes and Smart Review.
- Listening: US/UK, slow mode, four options, typed dictation, sentence gap, result saved after completion, no SRS overwrite.
- Speaking: recording and replay work; manual reflection persists after restarting.
- Cloud export includes new keys; importing an older backup still works without new keys.
- No internet: category pictograms and saved lessons work; real photos and IPA may be unavailable.
