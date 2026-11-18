interface RoutingGroup {
  readonly requestKeywords?: readonly string[];
  readonly requestContext?: readonly (readonly string[])[];
  readonly mutating?: boolean;
  /**
   * Selection order when more than `MAX_ROUTING_GROUPS` groups match. Lower
   * sorts first; ties keep declaration order. Research groups need this: a
   * request like "find trending editing styles" also matches the edit group
   * (the word "editing"), and the edit group is declared first, so without a
   * priority the web tools were crowded out of the 4-group budget and the agent
   * answered a trend question from stale memory instead of searching.
   */
  readonly priority?: number;
  /**
   * Same as `priority`, but only applies when one of these terms is present.
   * This keeps a passing mention of "web" from reordering unrelated requests,
   * which would otherwise displace whichever group the user actually needed.
   */
  readonly priorityFrom?: readonly string[];
  readonly tools: readonly string[];
}

const EDIT_VERBS = [
  'edit', 'add', 'insert', 'create', 'update', 'modify', 'adjust', 'apply', 'reorder',
  'delete', 'remove', 'trim', 'split', 'move', 'retime', 'slip',
  'Edit', 'Add', 'Add', 'New', 'Insert', 'Create', 'Modify', 'Adjust', 'Settings', 'Apply', 'Arrange', 'Sort', 'Rearrange',
  'Delete', 'Remove', 'Crop', 'Split', 'Move', 'Speed', 'Slide',
  // 中文 (zh)
  '编辑', '剪辑', '修改', '调整', '添加', '新增', '插入', '删除', '移除', '去掉',
  '移动', '剪裁', '裁切', '裁剪', '分割', '拆分', '分割', '变速', '排序', '重排', '应用',  // Short colloquial verbs Chinese users actually type. "加个标题" (add a title)
  // and "调一下颜色" are far more common than the formal 添加/调整, and omitting
  // them meant such a request was not recognised as an edit at all.
  '加', '加上', '加个', '放进', '放', '放到', '去掉', '换掉', '换个', '改', '改一下',
  '调一下', '调成', '设成', '设为', '转成', '变成', '拉长', '缩短', '放大', '缩小',
  '对齐', '居中', '翻转', '镜像', '静音', '加字幕', '配乐', '调色', '换背景',
  // Resultative completions (verb + 掉/好/成). "剪掉开头" (trim away the start) is
  // idiomatic and extremely common, but 剪 differs from 剪辑/剪裁 so the plain
  // verbs above miss it.
  '剪掉', '切掉', '砍掉', '删掉', '拿掉', '抽掉', '去掉', '砍', '切', '剪',  // 日本語 (ja)
  '編集', '調整', '追加', '削除', '移動', '分割', 'トリム', 'カット', '変更', '適用', '並べ替え',
  // 한국어 (ko)
  '편집', '수정', '추가', '삭제', '이동', '자르기', '분할', '조정', '적용', '정렬', '변경',
  // Русский (ru) — stems, because Cyrillic verbs inflect heavily
  // (редактировать / отредактировать / отредактируй).
  'редактир', 'измен', 'добав', 'удал', 'перемест', 'обреза', 'обреж', 'раздел', 'настро',
  'подрез', 'сдвин', 'сократ', 'удлин', 'встав', 'замен', 'удали', 'постав',
  // Español / Français / Deutsch / Português / Italiano
  'editar', 'añadir', 'agregar', 'eliminar', 'mover', 'recortar', 'dividir', 'ajustar', 'cambiar', 'modificar',
  'modifier', 'ajouter', 'supprimer', 'déplacer', 'couper', 'diviser', 'régler', 'changer',
  'bearbeiten', 'hinzufügen', 'löschen', 'verschieben', 'schneiden', 'teilen', 'ändern',
  'editar', 'adicionar', 'excluir', 'mover', 'cortar', 'dividir', 'ajustar',
  'modificare', 'aggiungere', 'eliminare', 'spostare', 'tagliare', 'dividere',
  // ไทย / हिन्दी / العربية
  'แก้ไข', 'เพิ่ม', 'ลบ', 'ย้าย', 'ตัด', 'แบ่ง',
  'संपादित', 'जोड़ें', 'हटाएं', 'ले जाएं', 'काटें', 'विभाजित',
  'تحرير', 'تعديل', 'إضافة', 'حذف', 'نقل', 'قص', 'تقسيم',
];
const EDIT_TARGETS = [
  'clip', 'item', 'track', 'timeline', 'sequence', 'title', 'text',
  'Clip', 'Track', 'Timeline', 'Sequences', 'Title', 'Text',
  // 中文
  '片段', '视频', '音频', '轨道', '时间线', '序列', '标题', '文字', '字幕', '素材',
  '那段', '这段', '开头', '结尾', '中间', '画面', '声音', '背景', '颜色', '时长',
  // 日本語 / 한국어
  'クリップ', 'トラック', 'タイムライン', 'シーケンス', 'テキスト', 'タイトル',
  '클립', '트랙', '타임라인', '시퀀스', '텍스트', '제목',
  // Русский
  'клип', 'дорожка', 'таймлайн', 'последовательность', 'заголовок', 'текст',
  // Romance/Germanic
  'clipe', 'pista', 'línea de tiempo', 'secuencia', 'título', 'texto',
  'piste', 'chronologie', 'séquence', 'titre', 'texte',
  'spur', 'zeitachse', 'sequenz', 'titel', 'text',
  'faixa', 'linha do tempo', 'sequência', 'título', 'texto',
  'traccia', 'sequenza', 'titolo', 'testo',
  // ไทย / हिन्दी / العربية
  'คลิป', 'แทร็ก', 'ไทม์ไลน์', 'ข้อความ', 'ชื่อ',
  'क्लिप', 'ट्रैक', 'टाइमलाइन', 'पाठ', 'शीर्षक',
  'مقطع', 'مسار', 'الخط الزمني', 'نص', 'عنوان',
];
const GENERATE_VERBS = [
  'generate', 'create', 'make', 'synthesize', 'Generate', 'Create', 'Produce', 'Composite',
];
const GENERATE_TARGETS = [
  'image', 'picture', 'photo', 'poster', 'video', 'music', 'sound', 'voiceover', 'shader',
  'Picture', 'Image', 'Photo', 'Poster', 'Video', 'Music', 'Sound Effects', 'Voiceover', 'Shader',
];

/**
 * Words that mean "go find out", as opposed to merely mentioning the web.
 * Used both as routing keywords for the web group and as the trigger that
 * boosts that group above the edit group.
 */
const RESEARCH_INTENT_TERMS: readonly string[] = [
  'trend', 'trending', 'trends', 'viral', 'popular', 'latest', 'newest', 'up to date',
  'inspiration', 'reference', 'example of', 'examples of',
  'best practice', 'best practices', 'how do people', 'how do others', 'what do people use',
  'research', 'look up', 'find out', 'google', 'browse the web',
  'tiktok', 'instagram', 'reels', 'youtube shorts', 'youtube', 'viral format',
  'Trend', 'Trending', 'Trends', 'Viral', 'Popular', 'Latest', 'Newest', 'Up to date',
  'Inspiration', 'Reference', 'Example of', 'Examples of',
  'Best practice', 'Best practices', 'Research', 'Look up', 'Find out', 'Browse the web',
  // 中文
  '趋势', '流行', '热门', '抖音', '网红', '参考', '灵感', '最新', '现在流行', '风格',
  '搜索', '查一下', '查查', '上网', '网页', '网站', '找些', '案例',
  // 日本語
  'トレンド', '人気', '最新', '参考', 'インスピレーション', '検索', '調べて', 'ウェブ',
  // 한국어
  '트렌드', '인기', '최신', '참고', '영감', '검색', '찾아봐', '웹',
  // Русский
  'тренд', 'популярн', 'актуальн', 'вдохнов', 'поиск', 'найди', 'интернет',
  // Español / Français / Deutsch / Português / Italiano
  'tendencia', 'inspiración', 'buscar', 'investigar',
  'tendance', 'inspiration', 'chercher', 'rechercher',
  'trend', 'beliebt', 'aktuell', 'suchen', 'recherche',
  'tendência', 'inspiração', 'pesquisar',
  'tendenza', 'ispirazione', 'cercare', 'ricerca',
  // ไทย / हिन्दी / العربية
  'เทรนด์', 'แรงบันดาลใจ', 'ค้นหา', 'เว็บ',
  'ट्रेंड', 'प्रेरणा', 'खोजें', 'वेब',
  'رائج', 'إلهام', 'ابحث', 'الويب',
];

const ROUTING_GROUPS: readonly RoutingGroup[] = [
  {
    mutating: true,
    requestKeywords: [
      'trim', 'split', 'move clip', 'delete clip', 'remove clip', 'retime', 'slip edit',
      'background fill', 'blur background', 'edit timeline',
      'Editing', 'Crop', 'Split', 'Move clip', 'Delete clip', 'Remove clip', 'Speed', 'Slip edit',
      'Background fill', 'Blurred background', 'Blur background',
      // 中文
      '剪辑', '剪裁', '裁切', '裁剪', '分割', '拆分', '移动片段', '删除片段', '变速',
      '背景填充', '模糊背景', '编辑时间线', '调色',
      // 日本語
      'トリム', '分割', 'クリップを移動', 'クリップを削除', '背景をぼかす', '編集',
      // 한국어
      '자르기', '분할', '클립 이동', '클립 삭제', '배경 흐리게', '편집',
      // Русский
      'обрезать', 'разделить', 'переместить клип', 'удалить клип', 'размытие фона',
      // Español / Français / Deutsch / Português / Italiano
      'recortar', 'dividir', 'mover clip', 'eliminar clip', 'desenfoque de fondo',
      'couper', 'diviser', 'déplacer le clip', 'supprimer le clip', 'flou d\'arrière-plan',
      'schneiden', 'teilen', 'clip verschieben', 'clip löschen', 'hintergrund verwischen',
      'cortar', 'dividir', 'mover clipe', 'excluir clipe', 'desfoque de fundo',
      'tagliare', 'dividere', 'sposta clip', 'elimina clip', 'sfocatura sfondo',
      // ไทย / हिन्दी / العربية
      'ตัด', 'แบ่ง', 'ย้ายคลิป', 'ลบคลิป', 'เบลอพื้นหลัง',
      'काटें', 'विभाजित', 'क्लिप ले जाएं', 'क्लिप हटाएं', 'पृष्ठभूमि धुंधला',
      'قص', 'تقسيم', 'نقل المقطع', 'حذف المقطع', 'تمويه الخلفية',
    ],
    requestContext: [EDIT_VERBS, EDIT_TARGETS],
    tools: [
      'update_item_props', 'move_item', 'set_item_timing', 'duplicate_item', 'remove_item',
      'split_item', 'manage_timelines', 'edit_track', 'edit_item', 'undo_last_change',
      'redo_last_change', 'apply_layout',
    ],
  },
  {
    requestKeywords: [
      'aspect ratio', 'canvas ratio', 'vertical video', 'landscape video',
      'Aspect Ratio', 'Landscape to portrait', 'Vertical to Horizontal', 'Video aspect ratio', 'Canvas aspect ratio',
    ],
    tools: ['set_aspect_ratio', 'apply_layout', 'auto_reframe'],
  },
  {
    requestContext: [
      ['elevenlabs', 'doubao', 'minimax', 'inworld', 'fish audio', 'fishaudio', 'speechify', 'openai', 'gemini', 'mistral', 'cartesia'],
      ['tts', 'text-to-speech', 'speech synthesis', 'voice generation', 'voiceover generation', 'Voiceover', 'Speech synthesis'],
    ],
    tools: ['submit_voice', 'track_progress', 'rerun_generation'],
  },
  {
    requestContext: [
      ['assemblyai', 'local', 'openai', 'mistral', 'deepgram', 'groq', 'elevenlabs', 'cartesia'],
      ['transcribe', 'transcription', 'speech-to-text', 'stt', 'asr', 'Transcribe', 'Speech recognition'],
    ],
    tools: ['transcribe_track', 'read_transcript', 'find_transcript'],
  },
  {
    requestKeywords: [
      'caption', 'subtitle', 'captions', 'subtitles', 'Subtitles',
      '字幕', '副标题', 'スーパー', '자막', 'субтитры', 'subtítulos', 'sous-titres',
      'untertitel', 'legendas', 'sottotitoli', 'คำบรรยาย', 'उपशीर्षक', 'ترجمة نصية',
    ],
    tools: [
      'read_captions', 'edit_captions', 'edit_item',
      'apply_caption_avoidance', 'place_graphics_in_safe_zone',
    ],
  },
  {
    requestKeywords: [
      'transcript', 'script', 'speech', 'Transcript', 'Dialogue', 'Talking Head', 'Transcript',
      '转录', '文案', '脚本', '对话', '文字稿', '音声', '書き起こし', '台本', '전사', '대본',
      'транскрипция', 'текст', 'guion', 'transcripción', 'transcription', 'transkript',
      'roteiro', 'trascrizione', 'ข้อความ', 'प्रतिलेख', 'نص الكلام',
    ],
    tools: [
      'read_transcript', 'find_transcript', 'clean_script', 'edit_gap', 'delete_text',
      'manage_transcript', 'read_script', 'apply_script',
    ],
  },
  {
    requestKeywords: [
      'silence', 'pause', 'filler word', 'Mute', 'Pauses', 'Filler words', 'Filler words',
      '静音', '停顿', '空白', '语气词', '无声', '無音', '間', '무음', '침묵', 'тишина', 'пауза',
      'silencio', 'pausa', 'sophie', 'силен', 'silêncio', 'silenzio', 'ความเงียบ', 'मौन', 'صمت',
    ],
    tools: ['read_transcript', 'find_transcript', 'clean_script', 'edit_gap', 'delete_text', 'remove_silence'],
  },
  {
    requestKeywords: [
      'audio', 'music', 'sound', 'loudness', 'bgm', 'soundtrack', 'music track', 'add music',
      'background music', 'Audio', 'Audio', 'Music', 'Sound Effects', 'Loudness', 'Background music', 'Music', 'Music track', 'Add music',
      '音频', '音乐', '声音', '音量', '音效', '配乐', '背景音乐', '音频轨',
      'オーディオ', '音楽', '音声', '音量', '効果音', '오디오', '음악', '소리', '음량', '효과음',
      'аудио', 'музыка', 'звук', 'громкость', 'música', 'sonido', 'volumen', 'musique', 'audio',
      'musik', 'ton', 'lautstärke', 'áudio', 'som', 'volume', 'musica', 'suono', 'เสียง', 'संगीत', 'موسيقى',
    ],
    tools: [
      'list_audio', 'add_audio', 'normalize_loudness', 'isolate_voice', 'detect_beats',
      'analyze_music', 'inspect_music', 'music_edit_plan', 'sync_cuts_to_music',
      'music_image_plan', 'sync_images_to_music',
      // Music beds: rank pool audio against the cut pace, then place a looped/ducked track.
      'find_music_for_timeline', 'add_music_track', 'auto_music_bed',
    ],
  },
  {
    requestKeywords: [
      'library', 'template', 'effect', 'transition', 'zoom', 'lut', 'graphic', 'watermark',
      'Media library', 'Template', 'Effects', 'Transitions', 'Motion', 'Watermark',
      '素材库', '媒体库', '模板', '特效', '转场', '水印', '图形', '缩放', '滤镜',
      'ライブラリ', 'テンプレート', 'エフェクト', 'トランジション', 'ズーム', 'ウォーターマーク',
      '라이브러리', '템플릿', '효과', '전환', '확대', '워터마크',
      'библиотека', 'шаблон', 'эффект', 'переход', 'масштаб', 'водяной знак',
      'biblioteca', 'plantilla', 'efecto', 'transición', 'bibliothèque', 'modèle', 'effet',
      'bibliothek', 'vorlage', 'effekt', 'übergang', 'biblioteca', 'modelo', 'efeito',
      'libreria', 'modello', 'effetto', 'transizione', 'คลัง', 'เทมเพลต', 'เอฟเฟกต์', 'प्रभाव', 'مكتبة',
    ],
    tools: [
      'list_templates', 'search_templates', 'browse_library', 'manage_effects', 'manage_template',
      'update_watermark', 'search_fonts', 'add_motion_graphic', 'create_motion_graphic',
      'submit_motion_graphic', 'create_motion_graphic_from_code',
    ],
  },
  {
    requestContext: [GENERATE_VERBS, GENERATE_TARGETS],
    tools: [
      'submit_image', 'submit_voice', 'submit_sound', 'submit_music', 'submit_video',
      'submit_shader', 'submit_motion_graphic', 'track_progress', 'rerun_generation',
    ],
  },
  {
    requestKeywords: [
      'import', 'upload', 'download', 'media', 'asset', 'stock', 'Assets', 'Import', 'Upload', 'Download', 'Media', 'Copyright',
      '导入', '上传', '下载', '素材', '媒体', '版权', 'インポート', 'アップロード', 'ダウンロード', '素材',
      '가져오기', '업로드', '다운로드', '미디어', 'импорт', 'загрузка', 'скачать', 'медиа',
      'importar', 'subir', 'descargar', 'medio', 'importer', 'téléverser', 'télécharger', 'média',
      'hochladen', 'herunterladen', 'medien', 'enviar', 'baixar', 'mídia', 'caricare', 'scaricare',
      'นำเข้า', 'อัปโหลด', 'ดาวน์โหลด', 'आयात', 'अपलोड', 'استيراد', 'تحميل',
    ],
    tools: [
      'search_media', 'manage_media_pool', 'download_media', 'push_asset', 'import_url_asset',
      'search_stock_media', 'edit_asset', 'import_media', 'finalize_uploaded_asset',
      'request_asset_download', 'probe_media',
      'browse_local_media', 'import_asset', 'import_assets', 'import_folder',
    ],
  },
  {
    requestKeywords: [
      'publish', 'post to', 'post on', 'post it', 'share to', 'upload to', 'upload-post',
      'Publish', 'Post to', 'Upload to',
    ],
    tools: ['publish_to_social', 'track_social_publish', 'submit_render_job', 'track_export'],
  },
  {
    requestKeywords: [
      'export', 'render', 'xml', 'prores', 'premiere', 'resolve', 'Export', 'Render', 'Final video',
      '导出', '渲染', '输出', '成片', 'エクスポート', '書き出し', '렌더', '내보내기', 'экспорт', 'рендер',
      'exportar', 'renderizar', 'exporter', 'rendu', 'exportieren', 'rendern', 'esportare',
      'ส่งออก', 'เรนเดอร์', 'निर्यात', 'تصدير',
    ],
    tools: [
      'submit_export', 'submit_render_job', 'track_export', 'read_export_history',
      'verify_export', 'download_media', 'export_motion_graphic_prores',
    ],
  },
  {
    requestKeywords: ['project', 'sequence', 'version', 'marker', 'design style', 'Project', 'Projects', 'Sequences', 'Version', 'Marker', 'Design Style'],
    tools: [
      'manage_timelines', 'manage_versions', 'manage_markers', 'manage_design_style', 'list_projects',
      'create_project', 'delete_project', 'restore_project', 'duplicate_project', 'edit_project',
      'target_project', 'get_editor_url',
    ],
  },
  {
    requestKeywords: [
      'scene', 'highlight', 'beat', 'downbeat', 'rhythm', 'multicam', 'reframe', 'color',
      'Shot', 'Highlights', 'Beat', 'Beat sync', 'Downbeat', 'Rhythm', 'Multicam', 'Reframe', 'Color grading', 'Analyze',
      // Visual inspection. Without these, "look at the video and tell me what's
      // wrong" routed to no vision tool at all: view_timeline_frames is not a
      // BOOT tool, so it is only offered when a keyword matches, and the model
      // fell back to describing the timeline from clip names — i.e. guessing at
      // pictures it had never seen. Every phrasing below is an explicit request
      // for the agent to LOOK, which is exactly when a rendered frame is the
      // only honest source of truth.
      'look', 'see', 'show me', 'check', 'inspect', 'review', 'verify', 'confirm',
      'wrong', 'broken', 'issue', 'problem', 'fix', 'screenshot', 'snapshot', 'preview',
      'frame', 'picture', 'image', 'visual', 'appearance', 'looks', 'look like', 'ugly',
      'alignment', 'overlap', 'overlapping', 'cut off', 'cropped', 'offscreen', 'off screen',
      'blank', 'black', 'empty', 'flicker', 'glitch',
      'Look', 'See', 'Show me', 'Check', 'Inspect', 'Review', 'Verify', 'Confirm',
      'Wrong', 'Broken', 'Issue', 'Problem', 'Fix', 'Screenshot', 'Snapshot', 'Preview',
      'Frame', 'Picture', 'Image', 'Visual', 'Appearance', 'Looks', 'Look like', 'Ugly',
      'Alignment', 'Overlap', 'Overlapping', 'Cut off', 'Cropped', 'Offscreen', 'Off screen',
      'Blank', 'Black', 'Empty', 'Flicker', 'Glitch',
      // Non-English "look at it" phrasings. Same reasoning as above: a user
      // asking to see the result must get a rendered frame no matter what
      // language they ask in.
      // 中文
      '看看', '看一下', '检查', '查看', '预览', '截图', '画面', '图片', '图像', '效果',
      '问题', '错误', '出错', '奇怪', '难看', '遮挡', '重叠', '超出', '被切', '黑屏', '空白', '闪烁',
      // 日本語
      '確認', 'チェック', '見て', '表示', 'プレビュー', 'スクリーンショット', '画像', '問題', 'おかしい',
      // 한국어
      '확인', '검토', '보여', '미리보기', '스크린샷', '이미지', '문제', '이상',
      // Русский
      'посмотреть', 'проверить', 'покажи', 'скриншот', 'изображение', 'проблема', 'ошибка',
      // Español / Français / Deutsch / Português / Italiano
      'ver', 'revisar', 'comprobar', 'mostrar', 'captura', 'imagen', 'problema', 'error',
      'voir', 'vérifier', 'montre', 'capture', 'image', 'problème', 'erreur',
      'ansehen', 'prüfen', 'zeigen', 'screenshot', 'bild', 'problem', 'fehler',
      'verificar', 'mostrar', 'imagem', 'problema', 'erro',
      'vedere', 'controllare', 'mostra', 'immagine', 'problema', 'errore',
      // ไทย / हिन्दी / العربية
      'ดู', 'ตรวจสอบ', 'แสดง', 'ภาพ', 'ปัญหา', 'ข้อผิดพลาด',
      'देखें', 'जांच', 'दिखाएं', 'छवि', 'समस्या', 'त्रुटि',
      'انظر', 'تحقق', 'أظهر', 'صورة', 'مشكلة', 'خطأ',
    ],
    tools: [
      'view_timeline_frames', 'view_asset_frames', 'detect_scenes', 'find_highlights', 'auto_reframe',
      'multicam_sync', 'change_cam', 'inspect_color', 'auto_grade', 'detect_beats', 'inspect_music',
      'music_image_plan', 'sync_images_to_music',
      'review_scene_plan',
    ],
  },
  {
    // Research/internet intent competes with the edit group on phrases like
    // "trending editing styles" (the word "editing" also matches the edit
    // group, which is declared first and would crowd the web tools out of the
    // 4-group budget). Research is only boosted when the request actually asks
    // to FIND OUT something, so a passing mention of "web" in an otherwise
    // unrelated request keeps the previous ordering.
    priorityFrom: RESEARCH_INTENT_TERMS,
    requestKeywords: [
      'web', 'search', 'crawl', 'website', 'skill', 'code', 'Web page', 'Search', 'Scrape', 'Website', 'Skills', 'Script',
      // Explicit research intent. "find trending editing styles", "what's
      // popular on TikTok", "look up a reference" need the live web, but contain
      // none of the words above, so research questions were answered from stale
      // training data instead of being looked up.
      ...RESEARCH_INTENT_TERMS,
    ],
    tools: [
      'web_browser', 'web_search', 'web_map', 'web_crawl', 'web_batch_scrape', 'manage_skill',
      'install_skill', 'run_skill_script', 'run_code', 'search_fonts',
    ],
  },
];
const ROUTING_TERM_PATTERNS = new Map<string, RegExp>();

// Routing keywords were Latin-only: `routingTermPattern` bailed out on anything
// that was not `^[a-z][a-z -]*$`, so a Chinese/Japanese/Korean/Arabic/Cyrillic
// keyword silently matched nothing and the whole group was unreachable for that
// user. Two consequences: non-English prompts routed to no specialist tools at
// all (the model then either guessed or burned turns on ToolSearch), and the
// mutating "edit" group never matched, so a Chinese "move and trim the clip"
// request was not even recognised as an edit.
//
// The fix is to detect the script rather than assume ASCII, and to match
// non-spaced scripts by substring instead of word boundary (JS `\b` is ASCII
// only, so `\b剪辑\b` never matches in CJK text).
const LATIN_TERM = /^[a-z][a-z '-]*$/;
// Scripts written without spaces between words: CJK ideographs and kana.
const UNSPACED_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
// Scripts that do use spaces but are not Latin: Cyrillic, Greek, Hebrew, Arabic,
// Thai, Devanagari. These keep word-boundary semantics.
const SPACED_NON_LATIN = /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]/;

function routingTermPattern(term: string): RegExp | null {
  const lower = term.toLowerCase();
  if (!lower.trim()) return null;
  const cached = ROUTING_TERM_PATTERNS.get(lower);
  if (cached) return cached;

  let pattern: RegExp;
  if (LATIN_TERM.test(lower)) {
    // English: keep the existing inflection handling (e.g. trim → trimming).
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let body = escaped;
    if (!lower.includes(' ')) {
      if (lower.endsWith('e')) body = `${escaped.slice(0, -1)}(?:e|es|ed|ing)`;
      else if (lower.endsWith('y')) body = `${escaped.slice(0, -1)}(?:y|ies|ied|ying)`;
      else body = `${escaped}(?:s|ed|ing)?`;
    }
    pattern = new RegExp(`\\b${body}\\b`);
  } else if (UNSPACED_SCRIPT.test(lower)) {
    // CJK/Kana: inflect by affix, not by word boundary. Matching on the bare
    // substring keeps 剪辑/剪辑一下 and 字幕/字幕样式 working.
    pattern = new RegExp(lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  } else if (SPACED_NON_LATIN.test(lower)) {
    // Cyrillic/Arabic/Thai/…: JS `\b` is ASCII-only so it is unusable here.
    // Terms are treated as STEMS rather than whole words, because these
    // languages inflect heavily and often prefix: Russian "редактировать"
    // (imperfective) vs "отредактировать" (perfective) differ by a leading "от",
    // so an anchored match would need every conjugational form enumerated.
    // Allowing the stem anywhere inside a word is the pragmatic trade: it can
    // over-match ("не редактируй" still reads as edit intent), but the read-only
    // guard runs on the remainder afterwards and wins in those cases.
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(escaped, 'u');
  } else {
    // Unknown script: plain substring, which is the safe fallback.
    pattern = new RegExp(lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  ROUTING_TERM_PATTERNS.set(lower, pattern);
  return pattern;
}

function requestHasRoutingTerm(request: string, term: string): boolean {
  const pattern = routingTermPattern(term);
  // `request` is already lower-cased by the callers; `toLowerCase` here keeps
  // this correct when called directly (hasMutationRoutingIntent passes lower).
  const haystack = request.toLowerCase();
  return pattern ? pattern.test(haystack) : haystack.includes(term.toLowerCase());
}

function routingGroupMatches(group: RoutingGroup, request: string): boolean {
  const direct = group.requestKeywords?.some((term) => requestHasRoutingTerm(request, term)) ?? false;
  const contextual = group.requestContext?.every((alternatives) => (
    alternatives.some((term) => requestHasRoutingTerm(request, term))
  )) ?? false;
  return direct || contextual;
}

/** Shared positive mutation matcher for routing and read-only-hint disambiguation. */
export function hasMutationRoutingIntent(request: string): boolean {
  const normalized = request.toLowerCase();
  // Research asks ABOUT editing rather than asking to edit: "find trending
  // editing styles" contains the edit verb "editing" but the user wants results,
  // not a timeline change. Treating it as a mutation would drop it from Plan
  // mode, which is exactly the mode where researching before proposing belongs.
  // Requiring an explicit research term keeps "edit this in the trending style"
  // as a genuine mutation.
  const isResearch = RESEARCH_INTENT_TERMS.some((term) => requestHasRoutingTerm(normalized, term));
  const editorialTargets = /(styles?|trends?|techniques?|examples?|ideas?|inspiration|references?|风格|趋势|技巧|案例|参考)/i;
  if (isResearch && editorialTargets.test(normalized)) {
    // Still mutating if a concrete editing target is also named (clip/track/…).
    const concrete = /(clip|item|track|timeline|sequence|片段|轨道|时间线|序列)/i;
    if (!concrete.test(normalized)) return false;
  }
  return ROUTING_GROUPS.some((group) => group.mutating && routingGroupMatches(group, normalized));
}


const MAX_ROUTING_GROUPS = 4;
export interface RoutedToolSelection {
  readonly names: ReadonlySet<string>;
  readonly matchedGroupCount: number;
  readonly overflow: boolean;
}


/** Effective selection order: a conditional boost wins only when its terms match. */
function groupPriority(group: RoutingGroup, request: string): number {
  if (group.priorityFrom?.some((term) => requestHasRoutingTerm(request, term))) return group.priority ?? -1;
  return group.priority ?? 0;
}

export function routedToolSelection(request: string, readOnly: boolean): RoutedToolSelection {
  const normalized = request.toLowerCase();
  const matching = ROUTING_GROUPS.filter((group) => (
    (!group.mutating || !readOnly) && routingGroupMatches(group, normalized)
  ));
  // Stable sort by priority (default 0), preserving declaration order on ties.
  // Without this the 4-group cap dropped the web group on any request that also
  // mentioned "editing", which is exactly the wording trend research uses.
  const ranked = matching
    .map((group, index) => ({ group, index, priority: groupPriority(group, normalized) }))
    .sort((a, b) => (a.priority - b.priority) || (a.index - b.index))
    .map((entry) => entry.group);
  const selected = ranked.slice(0, MAX_ROUTING_GROUPS);
  return {
    names: new Set(selected.flatMap((group) => group.tools)),
    matchedGroupCount: matching.length,
    overflow: matching.length > MAX_ROUTING_GROUPS,
  };
}

export function routedToolNames(request: string, readOnly: boolean): ReadonlySet<string> {
  return routedToolSelection(request, readOnly).names;
}
