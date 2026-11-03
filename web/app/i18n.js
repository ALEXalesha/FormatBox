// Русский и английский. t('ключ', { n }) - подстановка {n}; plural - формы для русского.
const RU = {
  'app.tagline': 'Конвертер всего: видео, звук, картинки, документы, архивы, 3D. Офлайн.',
  'theme': 'Тема', 'theme.glass': 'Стекло', 'theme.formal': 'Строгая', 'theme.light': 'Светлая', 'theme.night': 'Ночная', 'theme.warm': 'Тёплая',
  'lang': 'Язык',
  'add': 'Добавить файлы', 'drop': 'Перетащите файлы сюда или нажмите «Добавить файлы»', 'drop.short': 'Ещё файлы - сюда',
  'tools': 'Инструменты', 'tool.text3d': 'Текст в 3D', 'tool.join': 'Склеить видео',
  'presets': 'Готовые наборы',
  'preset.phone': 'Для телефона', 'preset.discord10': 'Discord 10 МБ', 'preset.email20': 'Почта 20 МБ', 'preset.audioFromVideo': 'Звук из видео',
  'preset.gif': 'GIF', 'preset.mp3': 'MP3 192', 'preset.cd': 'CD 16 бит', 'preset.nes': 'Звук NES', 'preset.gameboy': 'Звук Game Boy',
  'preset.web': 'Для сайта', 'preset.image1mb': 'До 1 МБ', 'preset.icon': 'Иконка ICO', 'preset.pdf': 'В PDF', 'preset.zip': 'В ZIP', 'preset.stl': 'STL с починкой',
  'queue': 'Очередь', 'queue.empty': 'Пока пусто',
  'start': 'Начать', 'startAll': 'Начать всё', 'cancel': 'Отменить', 'cancelAll': 'Отменить всё', 'clearDone': 'Убрать готовые', 'remove': 'Убрать',
  'save': 'Скачать', 'show': 'Показать в папке', 'open': 'Открыть',
  'state.idle': 'Готов к работе', 'state.waiting': 'В очереди', 'state.running': 'Идёт', 'state.done': 'Готово', 'state.failed': 'Ошибка', 'state.canceled': 'Отменено',
  'out.next': 'Результат: рядом с файлом', 'out.downloads': 'Результат: скачивание', 'out.folder': 'Папка: {name}', 'out.pick': 'Выбрать папку…', 'out.reset': 'Рядом с файлом',
  'panel.none': 'Выберите файл в очереди, чтобы настроить',
  'opt.to': 'Во что', 'opt.size': 'Размер', 'opt.maxMb': 'Не больше, МБ', 'opt.maxPx': 'Пикселей не больше', 'opt.any': 'как есть',
  'opt.resize': 'Изменить размер', 'resize.none': 'Нет', 'resize.percent': 'В процентах', 'resize.box': 'Ширина и высота',
  'opt.percent': 'Проценты', 'opt.width': 'Ширина', 'opt.height': 'Высота',
  'opt.fit': 'Как вписать', 'fit.contain': 'Вписать целиком', 'fit.cover': 'Заполнить с обрезкой', 'fit.stretch': 'Растянуть / ужать',
  'opt.crop': 'Обрезать края, %', 'crop.left': 'слева', 'crop.top': 'сверху', 'crop.right': 'справа', 'crop.bottom': 'снизу',
  'opt.quality': 'Качество', 'opt.trim': 'Кусок, секунды', 'trim.from': 'с', 'trim.to': 'по',
  'opt.rotate': 'Поворот', 'opt.flipH': 'Отразить слева направо', 'opt.flipV': 'Отразить сверху вниз',
  'opt.mute': 'Убрать звук', 'opt.speed': 'Скорость', 'opt.fps': 'Кадров в секунду',
  'opt.audioKbps': 'Битрейт звука, кбит/с', 'opt.bits': 'Разрядность', 'opt.rate': 'Частота', 'opt.channels': 'Каналы', 'opt.dither': 'Дизеринг',
  'bits.8': '8 бит', 'bits.16': '16 бит', 'bits.24': '24 бита', 'bits.32': '32 бита float',
  'ch.mono': 'Моно', 'ch.stereo': 'Стерео', 'dither.none': 'Нет', 'dither.tpdf': 'Треугольный (TPDF)', 'dither.shaped': 'С формой шума',
  'opt.chip': 'Звук приставки', 'chip.none': 'Нет', 'chip.nes': 'NES (8 бит)', 'chip.gameboy': 'Game Boy', 'chip.16bit': '16 бит (Sega/SNES)',
  'opt.remix': 'Переиграть на приставке', 'remix.hint': 'Мелодия, бас и барабаны -> ноты -> квадрат, треугольник и шум как у NES',
  'remix.melody': 'Мелодия', 'remix.bass': 'Бас', 'remix.drums': 'Барабаны', 'preview10': 'Послушать 10 с', 'preview': 'Предпросмотр',
  'opt.stripMeta': 'Удалить EXIF и другие сведения', 'opt.removeBg': 'Убрать фон', 'opt.tolerance': 'Похожесть цвета фона',
  'opt.watermark': 'Водяной знак', 'opt.wmText': 'Текст', 'opt.wmOpacity': 'Прозрачность', 'opt.wmTile': 'Замостить',
  'opt.icoSizes': 'Размеры иконки',
  'opt.to3d': 'В 3D из картинки', 'to3d.none': 'Нет', 'to3d.litho': 'Литофания плоская', 'to3d.curved': 'Литофания изогнутая', 'to3d.cylinder': 'Цилиндр-ночник',
  'to3d.relief': 'Рельеф по карте высот', 'to3d.keychain': 'Брелок', 'to3d.sign': 'Табличка', 'to3d.cookie': 'Формочка для печенья', 'to3d.stencil': 'Трафарет', 'to3d.plain': 'Силуэт',
  'opt.widthMm': 'Ширина, мм', 'opt.minMm': 'Тоньше всего, мм', 'opt.maxMm': 'Толще всего, мм', 'opt.heightMm': 'Высота, мм', 'opt.colors': 'Цветных слоёв (смена пластика)',
  'opt.repair': 'Починить сетку', 'opt.decimate': 'Оставить полигонов, %', 'opt.units': 'Единицы файла', 'units.mm': 'мм', 'units.in': 'дюймы', 'units.cm': 'см',
  'opt.material': 'Пластик', 'opt.infill': 'Заполнение, %', 'opt.price': 'Цена за кг',
  'est.weight': 'Вес', 'est.length': 'Нить', 'est.cost': 'Цена', 'est.volume': 'Объём', 'est.size': 'Габариты', 'est.tris': 'Треугольников', 'est.watertight': 'Замкнута', 'est.open': 'Есть дыры',
  'opt.m600': 'Смена пластика на высотах, мм', 'm600.hint': 'Через запятую, например 2, 4.4. Вставит M600 перед слоем.',
  'archive.list': 'Внутри архива', 'archive.files': '{n} файлов', 'archive.extract': 'Извлечь всё', 'archive.repack': 'Перепаковать',
  'doc.office': 'LibreOffice: {state}', 'office.yes': 'есть', 'office.no': 'нет - документы через встроенный модуль', 'office.get': 'Скачать LibreOffice', 'office.recheck': 'Проверить снова',
  'text3d.title': 'Текст в 3D', 'text3d.text': 'Текст', 'text3d.make': 'Сделать', 'join.need': 'Выберите два видео или больше (Ctrl+щелчок)',
  'err.unknown': 'Не знаю этот формат', 'err.canceled': 'Отменено', 'err.size-unreachable': 'Нельзя сжать до такого размера', 'err.size-needs-compressed-audio': 'WAV и FLAC не сжимаются до размера - выберите MP3 или OGG',
  'err.size-not-for-gif': 'Для GIF задайте пиксели, а не МБ', 'err.no-target': 'Выберите, во что превратить', 'err.ffmpeg-failed': 'ffmpeg не справился с файлом', 'err.not-media': 'Это не видео и не звук',
  'err.too-big': 'Файл слишком большой для браузера - используйте версию для ПК',
  'ffmpeg.loading': 'Загружаю ffmpeg (31 МБ, один раз)…', 'working': 'Работаю…', 'saved': 'Сохранено: {name}',
  'size.result': '{size} вместо {orig}', 'about': 'О программе',
  'credits': 'Код, тесты и документацию написал Claude (Anthropic) в Claude Code; идеи, проверка и решения - Алексея.',
};

const EN = {
  'app.tagline': 'Convert everything: video, audio, images, documents, archives, 3D. Offline.',
  'theme': 'Theme', 'theme.glass': 'Glass', 'theme.formal': 'Formal', 'theme.light': 'Light', 'theme.night': 'Night', 'theme.warm': 'Warm',
  'lang': 'Language',
  'add': 'Add files', 'drop': 'Drop files here or press "Add files"', 'drop.short': 'More files - here',
  'tools': 'Tools', 'tool.text3d': 'Text to 3D', 'tool.join': 'Join videos',
  'presets': 'Presets',
  'preset.phone': 'For phone', 'preset.discord10': 'Discord 10 MB', 'preset.email20': 'Email 20 MB', 'preset.audioFromVideo': 'Audio from video',
  'preset.gif': 'GIF', 'preset.mp3': 'MP3 192', 'preset.cd': 'CD 16 bit', 'preset.nes': 'NES sound', 'preset.gameboy': 'Game Boy sound',
  'preset.web': 'For the web', 'preset.image1mb': 'Up to 1 MB', 'preset.icon': 'ICO icon', 'preset.pdf': 'To PDF', 'preset.zip': 'To ZIP', 'preset.stl': 'STL, repaired',
  'queue': 'Queue', 'queue.empty': 'Nothing yet',
  'start': 'Start', 'startAll': 'Start all', 'cancel': 'Cancel', 'cancelAll': 'Cancel all', 'clearDone': 'Clear finished', 'remove': 'Remove',
  'save': 'Download', 'show': 'Show in folder', 'open': 'Open',
  'state.idle': 'Ready', 'state.waiting': 'Waiting', 'state.running': 'Working', 'state.done': 'Done', 'state.failed': 'Failed', 'state.canceled': 'Canceled',
  'out.next': 'Output: next to the file', 'out.downloads': 'Output: download', 'out.folder': 'Folder: {name}', 'out.pick': 'Choose folder…', 'out.reset': 'Next to the file',
  'panel.none': 'Select a file in the queue to set it up',
  'opt.to': 'Convert to', 'opt.size': 'Size', 'opt.maxMb': 'At most, MB', 'opt.maxPx': 'Pixels at most', 'opt.any': 'as is',
  'opt.resize': 'Resize', 'resize.none': 'No', 'resize.percent': 'By percent', 'resize.box': 'Width and height',
  'opt.percent': 'Percent', 'opt.width': 'Width', 'opt.height': 'Height',
  'opt.fit': 'Fit', 'fit.contain': 'Fit inside', 'fit.cover': 'Fill and crop', 'fit.stretch': 'Stretch / squeeze',
  'opt.crop': 'Crop edges, %', 'crop.left': 'left', 'crop.top': 'top', 'crop.right': 'right', 'crop.bottom': 'bottom',
  'opt.quality': 'Quality', 'opt.trim': 'Part, seconds', 'trim.from': 'from', 'trim.to': 'to',
  'opt.rotate': 'Rotate', 'opt.flipH': 'Mirror left-right', 'opt.flipV': 'Mirror top-bottom',
  'opt.mute': 'Remove audio', 'opt.speed': 'Speed', 'opt.fps': 'Frames per second',
  'opt.audioKbps': 'Audio bitrate, kbit/s', 'opt.bits': 'Bit depth', 'opt.rate': 'Sample rate', 'opt.channels': 'Channels', 'opt.dither': 'Dither',
  'bits.8': '8 bit', 'bits.16': '16 bit', 'bits.24': '24 bit', 'bits.32': '32 bit float',
  'ch.mono': 'Mono', 'ch.stereo': 'Stereo', 'dither.none': 'None', 'dither.tpdf': 'Triangular (TPDF)', 'dither.shaped': 'Noise shaped',
  'opt.chip': 'Console sound', 'chip.none': 'None', 'chip.nes': 'NES (8 bit)', 'chip.gameboy': 'Game Boy', 'chip.16bit': '16 bit (Sega/SNES)',
  'opt.remix': 'Replay on a console', 'remix.hint': 'Melody, bass and drums -> notes -> square, triangle and noise like the NES',
  'remix.melody': 'Melody', 'remix.bass': 'Bass', 'remix.drums': 'Drums', 'preview10': 'Listen 10 s', 'preview': 'Preview',
  'opt.stripMeta': 'Remove EXIF and other details', 'opt.removeBg': 'Remove background', 'opt.tolerance': 'Background color match',
  'opt.watermark': 'Watermark', 'opt.wmText': 'Text', 'opt.wmOpacity': 'Opacity', 'opt.wmTile': 'Tile',
  'opt.icoSizes': 'Icon sizes',
  'opt.to3d': '3D from the picture', 'to3d.none': 'No', 'to3d.litho': 'Flat lithophane', 'to3d.curved': 'Curved lithophane', 'to3d.cylinder': 'Cylinder night light',
  'to3d.relief': 'Relief from a height map', 'to3d.keychain': 'Keychain', 'to3d.sign': 'Sign', 'to3d.cookie': 'Cookie cutter', 'to3d.stencil': 'Stencil', 'to3d.plain': 'Silhouette',
  'opt.widthMm': 'Width, mm', 'opt.minMm': 'Thinnest, mm', 'opt.maxMm': 'Thickest, mm', 'opt.heightMm': 'Height, mm', 'opt.colors': 'Color layers (filament change)',
  'opt.repair': 'Repair the mesh', 'opt.decimate': 'Keep polygons, %', 'opt.units': 'File units', 'units.mm': 'mm', 'units.in': 'inches', 'units.cm': 'cm',
  'opt.material': 'Filament', 'opt.infill': 'Infill, %', 'opt.price': 'Price per kg',
  'est.weight': 'Weight', 'est.length': 'Filament', 'est.cost': 'Cost', 'est.volume': 'Volume', 'est.size': 'Size', 'est.tris': 'Triangles', 'est.watertight': 'Watertight', 'est.open': 'Has holes',
  'opt.m600': 'Filament change at heights, mm', 'm600.hint': 'Comma separated, like 2, 4.4. Inserts M600 before the layer.',
  'archive.list': 'Inside the archive', 'archive.files': '{n} files', 'archive.extract': 'Extract all', 'archive.repack': 'Repack',
  'doc.office': 'LibreOffice: {state}', 'office.yes': 'found', 'office.no': 'not found - documents use the built-in module', 'office.get': 'Get LibreOffice', 'office.recheck': 'Check again',
  'text3d.title': 'Text to 3D', 'text3d.text': 'Text', 'text3d.make': 'Make', 'join.need': 'Select two videos or more (Ctrl+click)',
  'err.unknown': 'Unknown format', 'err.canceled': 'Canceled', 'err.size-unreachable': 'Cannot squeeze to this size', 'err.size-needs-compressed-audio': 'WAV and FLAC cannot be sized - choose MP3 or OGG',
  'err.size-not-for-gif': 'For GIF set pixels, not MB', 'err.no-target': 'Choose what to convert to', 'err.ffmpeg-failed': 'ffmpeg could not process the file', 'err.not-media': 'Not a video or audio file',
  'err.too-big': 'The file is too big for the browser - use the desktop version',
  'ffmpeg.loading': 'Loading ffmpeg (31 MB, once)…', 'working': 'Working…', 'saved': 'Saved: {name}',
  'size.result': '{size} instead of {orig}', 'about': 'About',
  'credits': 'Code, tests and docs are written by Claude (Anthropic) in Claude Code; ideas, testing and decisions - Alexey.',
};

export const DICTS = { ru: RU, en: EN };
let lang = 'ru';

export function setLang(code) { lang = DICTS[code] ? code : 'en'; return lang; }
export function getLang() { return lang; }

export function t(key, vars = {}) {
  const text = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function guessLang(list) {
  for (const l of list || []) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code === 'ru' || code === 'uk' || code === 'be') return 'ru';
    if (code === 'en') return 'en';
  }
  return 'en';
}

export function humanSize(bytes) {
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const num = i === 0 ? String(v) : v.toFixed(v < 10 ? 2 : 1);
  return `${lang === 'ru' ? num.replace('.', ',') : num} ${units[i]}`;
}
