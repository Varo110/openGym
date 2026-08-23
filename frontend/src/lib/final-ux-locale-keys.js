// Locale additions for the final workout configuration and progression UX.
// These values are real translations rather than a spread of the English source pack.
const keys = {
  en: {
    '% of e1RM': '% of e1RM',
    Adaptive: 'Adaptive',
    'Latest session': 'Latest session',
    'Median inputs': 'Median inputs',
    Retention: 'Retention',
    '1RM source': '1RM source',
    '{0} e1RM {1} × {2}% → {3}': '{0} e1RM {1} × {2}% → {3}',
    'Using setup from {0} · {1}': 'Using setup from {0} · {1}',
    'Use exercise defaults': 'Use exercise defaults',
    'Open progression settings': 'Open progression settings',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Add time · every set held for the full duration → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Double · keep {0} {1}; aim for {2} reps on every set.'
  },
  de: {
    '% of e1RM': '% des e1RM', Adaptive: 'Adaptiv', 'Latest session': 'Letzte Einheit', 'Median inputs': 'Medianwerte', Retention: 'Erhalt',
    '1RM source': '1RM-Quelle', '{0} e1RM {1} × {2}% → {3}': '{0}-e1RM {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Einstellung vom {0} · {1}', 'Use exercise defaults': 'Übungsstandard verwenden', 'Open progression settings': 'Progressionseinstellungen öffnen',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Zeit erhöhen · jede Serie vollständig gehalten → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP doppelt erreicht → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP-Mindestziel erreicht → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Doppelt · {0}×{1} geschafft → {2} {3} (+{4} {3}); zurück auf {5} Wiederholungen.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Linear · {0}×{1} geschafft → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Doppelt · {0} {1} halten; in jeder Serie {2} Wiederholungen anpeilen.'
  },
  es: {
    '% of e1RM': '% del e1RM', Adaptive: 'Adaptativo', 'Latest session': 'Última sesión', 'Median inputs': 'Valores medianos', Retention: 'Retención',
    '1RM source': 'Fuente del 1RM', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Usando configuración del {0} · {1}', 'Use exercise defaults': 'Usar valores predeterminados', 'Open progression settings': 'Abrir ajustes de progresión',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Añadir tiempo · todas las series completas → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP duplicó el objetivo → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · mínimo de AMRAP alcanzado → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Doble · {0}×{1} completadas → {2} {3} (+{4} {3}); volver a {5} repeticiones.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Lineal · {0}×{1} completadas → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Doble · mantener {0} {1}; buscar {2} repeticiones en cada serie.'
  },
  fr: {
    '% of e1RM': '% de l’e1RM', Adaptive: 'Adaptatif', 'Latest session': 'Dernière séance', 'Median inputs': 'Valeurs médianes', Retention: 'Rétention',
    '1RM source': 'Source du 1RM', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Configuration du {0} · {1}', 'Use exercise defaults': 'Utiliser les valeurs par défaut', 'Open progression settings': 'Ouvrir les réglages de progression',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Ajouter du temps · chaque série tenue entièrement → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP a doublé la cible → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · minimum AMRAP atteint → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Double · {0}×{1} réussies → {2} {3} (+{4} {3}); revenir à {5} répétitions.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Linéaire · {0}×{1} réussies → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Double · garder {0} {1} ; viser {2} répétitions par série.'
  },
  it: {
    '% of e1RM': '% dell’e1RM', Adaptive: 'Adattivo', 'Latest session': 'Ultima sessione', 'Median inputs': 'Valori mediani', Retention: 'Mantenimento',
    '1RM source': 'Fonte dell’1RM', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Configurazione del {0} · {1}', 'Use exercise defaults': 'Usa i valori predefiniti', 'Open progression settings': 'Apri le impostazioni di progressione',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Aumenta il tempo · ogni serie completata → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP al doppio del target → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · minimo AMRAP raggiunto → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Doppia · {0}×{1} completate → {2} {3} (+{4} {3}); torna a {5} ripetizioni.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Lineare · {0}×{1} completate → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Doppia · mantieni {0} {1}; punta a {2} ripetizioni per serie.'
  },
  pt: {
    '% of e1RM': '% do e1RM', Adaptive: 'Adaptativo', 'Latest session': 'Última sessão', 'Median inputs': 'Valores medianos', Retention: 'Retenção',
    '1RM source': 'Fonte do 1RM', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'A usar configuração de {0} · {1}', 'Use exercise defaults': 'Usar valores predefinidos', 'Open progression settings': 'Abrir definições de progressão',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Adicionar tempo · todas as séries completas → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP atingiu o dobro do alvo → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · mínimo de AMRAP atingido → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Dupla · {0}×{1} concluídas → {2} {3} (+{4} {3}); voltar a {5} repetições.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Linear · {0}×{1} concluídas → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Dupla · manter {0} {1}; apontar a {2} repetições por série.'
  },
  pl: {
    '% of e1RM': '% e1RM', Adaptive: 'Adaptacyjne', 'Latest session': 'Ostatnia sesja', 'Median inputs': 'Wartości mediany', Retention: 'Utrzymanie',
    '1RM source': 'Źródło 1RM', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Używana konfiguracja z {0} · {1}', 'Use exercise defaults': 'Użyj wartości domyślnych ćwiczenia', 'Open progression settings': 'Otwórz ustawienia progresji',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Dodaj czas · każda seria utrzymana w całości → {0}s (+{1}s).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP osiągnął dwukrotność celu → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · osiągnięto minimum AMRAP → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Podwójna · ukończono {0}×{1} → {2} {3} (+{4} {3}); wróć do {5} powtórzeń.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Liniowa · ukończono {0}×{1} → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Podwójna · utrzymaj {0} {1}; celuj w {2} powtórzeń w każdej serii.'
  },
  tr: {
    '% of e1RM': 'e1RM yüzdesi', Adaptive: 'Uyarlanabilir', 'Latest session': 'Son seans', 'Median inputs': 'Medyan değerler', Retention: 'Koruma',
    '1RM source': '1RM kaynağı', '{0} e1RM {1} × {2}% → {3}': '{0} e1RM {1} × {2}% → {3}', 'Using setup from {0} · {1}': '{0} tarihli ayar kullanılıyor · {1}', 'Use exercise defaults': 'Egzersiz varsayılanlarını kullan', 'Open progression settings': 'İlerleme ayarlarını aç',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Süre ekle · her set tam tutuldu → {0} sn (+{1} sn).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP hedefin iki katına ulaştı → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP minimumu karşılandı → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Çift · {0}×{1} tamamlandı → {2} {3} (+{4} {3}); {5} tekrara dön.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Doğrusal · {0}×{1} tamamlandı → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Çift · {0} {1} koru; her sette {2} tekrar hedefle.'
  },
  ru: {
    '% of e1RM': '% от e1RM', Adaptive: 'Адаптивный', 'Latest session': 'Последняя тренировка', 'Median inputs': 'Медианные значения', Retention: 'Сохранение',
    '1RM source': 'Источник 1ПМ', '{0} e1RM {1} × {2}% → {3}': 'e1RM {0} {1} × {2}% → {3}', 'Using setup from {0} · {1}': 'Используется настройка от {0} · {1}', 'Use exercise defaults': 'Использовать настройки упражнения', 'Open progression settings': 'Открыть настройки прогрессии',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'Добавить время · каждый подход выполнен полностью → {0} с (+{1} с).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP вдвое выше цели → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'Минимум AMRAP выполнен → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'Двойная · выполнено {0}×{1} → {2} {3} (+{4} {3}); вернитесь к {5} повторам.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'Линейная · выполнено {0}×{1} → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'Двойная · сохраняйте {0} {1}; цель — {2} повторов в каждом подходе.'
  },
  zh: {
    '% of e1RM': 'e1RM 百分比', Adaptive: '自适应', 'Latest session': '最近一次训练', 'Median inputs': '中位数输入', Retention: '保留率',
    '1RM source': '1RM 来源', '{0} e1RM {1} × {2}% → {3}': '{0} e1RM {1} × {2}% → {3}', 'Using setup from {0} · {1}': '使用 {0} 的设置 · {1}', 'Use exercise defaults': '使用动作默认值', 'Open progression settings': '打开进阶设置',
    'Add time · every set held for the full duration → {0}s (+{1}s).': '增加时间 · 每组都完成完整时长 → {0} 秒（+{1} 秒）。',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP 达到目标两倍 → {0} {1}（+{2} {1}）。',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'AMRAP 达到上次最低目标 → {0} {1}（+{2} {1}）。',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': '双进阶 · 完成 {0}×{1} → {2} {3}（+{4} {3}）；重置为 {5} 次。',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': '线性 · 完成 {0}×{1} → {2} {3}（+{4} {3}）。',
    'Double · keep {0} {1}; aim for {2} reps on every set.': '双进阶 · 保持 {0} {1}；每组目标 {2} 次。'
  },
  ko: {
    '% of e1RM': 'e1RM의 %', Adaptive: '적응형', 'Latest session': '최근 세션', 'Median inputs': '중앙값 입력', Retention: '유지율',
    '1RM source': '1RM 출처', '{0} e1RM {1} × {2}% → {3}': '{0} e1RM {1} × {2}% → {3}', 'Using setup from {0} · {1}': '{0} 설정 사용 · {1}', 'Use exercise defaults': '운동 기본값 사용', 'Open progression settings': '진행 설정 열기',
    'Add time · every set held for the full duration → {0}s (+{1}s).': '시간 추가 · 모든 세트를 전체 시간 유지 → {0}초 (+{1}초).',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': '그레이스컬 LP · AMRAP가 목표의 두 배 → {0} {1} (+{2} {1}).',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'AMRAP 최소 목표 달성 → {0} {1} (+{2} {1}).',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': '더블 · {0}×{1} 완료 → {2} {3} (+{4} {3}); {5}회로 재설정.',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': '선형 · {0}×{1} 완료 → {2} {3} (+{4} {3}).',
    'Double · keep {0} {1}; aim for {2} reps on every set.': '더블 · {0} {1} 유지; 매 세트 {2}회 목표.'
  },
  hi: {
    '% of e1RM': 'e1RM का %', Adaptive: 'अनुकूली', 'Latest session': 'पिछला सत्र', 'Median inputs': 'मध्यिका मान', Retention: 'प्रतिधारण',
    '1RM source': '1RM स्रोत', '{0} e1RM {1} × {2}% → {3}': '{0} e1RM {1} × {2}% → {3}', 'Using setup from {0} · {1}': '{0} की सेटअप इस्तेमाल हो रही है · {1}', 'Use exercise defaults': 'व्यायाम के डिफ़ॉल्ट इस्तेमाल करें', 'Open progression settings': 'प्रगति सेटिंग खोलें',
    'Add time · every set held for the full duration → {0}s (+{1}s).': 'समय बढ़ाएँ · हर सेट पूरी अवधि तक रहा → {0} सेकंड (+{1} सेकंड)।',
    'Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).': 'Greyskull LP · AMRAP लक्ष्य से दोगुना → {0} {1} (+{2} {1})।',
    'Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).': 'AMRAP न्यूनतम पूरा हुआ → {0} {1} (+{2} {1})।',
    'Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.': 'डबल · {0}×{1} पूरा → {2} {3} (+{4} {3}); {5} रेप्स पर लौटें।',
    'Linear · {0}×{1} complete → {2} {3} (+{4} {3}).': 'लीनियर · {0}×{1} पूरा → {2} {3} (+{4} {3})।',
    'Double · keep {0} {1}; aim for {2} reps on every set.': 'डबल · {0} {1} बनाए रखें; हर सेट में {2} रेप्स का लक्ष्य रखें।'
  }
}

const bestHistorical = {
  en: 'Best historical:', de: 'Bester historischer Wert:', es: 'Mejor histórico:', fr: 'Meilleur historique :',
  it: 'Migliore storico:', pt: 'Melhor histórico:', pl: 'Najlepszy wynik historyczny:', tr: 'En iyi geçmiş değer:',
  ru: 'Лучший исторический:', zh: '历史最佳：', ko: '최고 기록:', hi: 'सर्वश्रेष्ठ ऐतिहासिक:'
}

export const finalUxLocaleKeys = locale => ({ ...keys.en, ...(keys[locale] || {}), 'Best historical:': bestHistorical[locale] || bestHistorical.en })
