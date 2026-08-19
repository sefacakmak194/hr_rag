/**
 * Tek dosyalik Windows calistirilabiliri uretir (Node SEA).
 *
 * NEDEN TAM ANLAMIYLA "tek dosya" degil:
 * `onnxruntime-node` ~60 MB native DLL tasir (onnxruntime.dll, DirectML.dll,
 * dxcompiler.dll). Windows yukleyicisi bunlari DISKTEN okur; SEA blob'una
 * gomulemezler. Bu yuzden exe'nin yaninda `runtime/` klasoru bulunur.
 * Kullanici acisindan yine tek bir sey calistirilir: PrivateHrRag.exe
 *
 * Kullanim:  cd server && npm run build:exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');

// esbuild/postject server/node_modules altinda kurulu; bu script scripts/ altinda
// oldugundan cozumlemeyi acikca oraya yonlendiriyoruz.
const serverRequire = createRequire(path.join(SERVER, 'package.json'));
const { build } = serverRequire('esbuild');
const OUT = path.join(ROOT, 'dist-app');
const WORK = path.join(SERVER, '.sea-build');

const log = (msg) => console.log(`  ${msg}`);

// ---------------------------------------------------------------- temizlik
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

console.log('\n  Private HR RAG — .exe paketleme\n');

// ------------------------------------------------------------- 1) bundle
// onnxruntime-node native oldugu icin bundle EDILMEZ; exe yanindan yuklenir.
// @huggingface/transformers onu require ettiginden o da disarida birakilir.
// tesseract.js worker dosyalarini disk uzerinden yukler, mammoth ve sharp de
// bundle edilmemeli; hepsi exe'nin yanindaki runtime/node_modules'ten cozulur.
const EXTERNALS = [
  'onnxruntime-node',
  '@huggingface/transformers',
  'sharp',
  'tesseract.js',
  'mammoth',
  // pdfjs createRequire ile calisma aninda yukleniyor; esbuild bunu goremez.
  // External + runtime kopyasi olmadan paketlenmis modda "Cannot find module
  // 'pdfjs-dist/legacy/build/pdf.mjs'" hatasi veriyordu (olculdu).
  'pdfjs-dist',
];

log('1/5  Sunucu kodu bundle ediliyor (esbuild)...');
await build({
  entryPoints: [path.join(SERVER, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: path.join(WORK, 'bundle.cjs'),
  external: EXTERNALS,
  minify: true,
  // SEA icinde require() yalnizca yerlesik modulleri yukleyebilir. Gercek bir
  // require elde etmek icin exe'nin yanindaki node_modules'e bakan createRequire
  // kurulur ve bundle'in kullandigi require ile degistirilir.
  banner: {
    js: [
      "const __nodeModule = require('node:module');",
      "const __nodePath = require('node:path');",
      'const __execDir = __nodePath.dirname(process.execPath);',
      "const __realRequire = __nodeModule.createRequire(__nodePath.join(__execDir, 'runtime', 'noop.js'));",
      'const __origRequire = require;',
      'require = function (id) {',
      `  if (${JSON.stringify(EXTERNALS)}.some((e) => id === e || id.startsWith(e + '/'))) {`,
      '    return __realRequire(id);',
      '  }',
      '  return __origRequire(id);',
      '};',
    ].join('\n'),
  },
  define: { 'process.env.PHR_PACKAGED': '"1"' },
});
log(`     bundle.cjs (${(fs.statSync(path.join(WORK, 'bundle.cjs')).size / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------- 2) blob
log('2/5  SEA blob olusturuluyor...');
const seaConfig = {
  main: path.join(WORK, 'bundle.cjs'),
  output: path.join(WORK, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
};
fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(WORK, 'sea-config.json')], {
  stdio: 'inherit',
});

// ----------------------------------------------------------------- 3) exe
log('3/5  node.exe kopyalanip blob enjekte ediliyor...');
const exePath = path.join(OUT, 'PrivateHrRag.exe');
fs.copyFileSync(process.execPath, exePath);

const postjectCli = path.join(SERVER, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(
  process.execPath,
  [
    postjectCli,
    exePath,
    'NODE_SEA_BLOB',
    seaConfig.output,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
);

// ------------------------------------------------------------ 4) runtime
log('4/5  Native bagimliliklar ve arayuz kopyalaniyor...');

const copyDir = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};

// Sadece bu platformun native ikililerini tasi (diger OS'ler ~1 MB bosa yer kaplar).
const runtimeModules = path.join(OUT, 'runtime', 'node_modules');
fs.mkdirSync(runtimeModules, { recursive: true });
fs.writeFileSync(path.join(OUT, 'runtime', 'noop.js'), '// createRequire capasi\n');

/**
 * Bir paketi VE bagimlilik kapanisini exe yanina kopyalar.
 *
 * DIKKAT — kapanis sart. `sharp`, `tesseract.js` ve `mammoth` external olarak
 * isaretlendigi icin bundle icine girmiyor; yalnizca kendileri kopyalanirsa
 * exe calisma aninda "Cannot find module 'jszip'" gibi hatalar veriyor.
 * npm node_modules'u duz tuttugu icin bagimliliklari ayni dizinden cozuyoruz.
 */
const copied = new Set();
const copyModuleClosure = (name) => {
  if (copied.has(name)) return;
  const src = path.join(SERVER, 'node_modules', name);
  if (!fs.existsSync(src)) return;

  copied.add(name);
  copyDir(src, path.join(runtimeModules, name));

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf-8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) copyModuleClosure(dep);
    // optionalDependencies: sharp'in platform ikilileri buradan gelir.
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) copyModuleClosure(dep);
  } catch {
    /* package.json okunamadi — yalnizca paketin kendisi kopyalandi */
  }
};

for (const mod of [
  'onnxruntime-node',
  '@huggingface/transformers',
  'onnxruntime-common',
  'sharp', // OCR: ham piksel -> PNG
  'tesseract.js', // OCR motoru
  'mammoth', // DOCX okuma
  'pdfjs-dist', // PDF metin cikarimi
]) {
  copyModuleClosure(mod);
}

// Kullanilmayan platform ikililerini at.
const napi = path.join(runtimeModules, 'onnxruntime-node', 'bin', 'napi-v6');
if (fs.existsSync(napi)) {
  for (const osDir of fs.readdirSync(napi)) {
    if (osDir !== 'win32') fs.rmSync(path.join(napi, osDir), { recursive: true, force: true });
  }
  const win32 = path.join(napi, 'win32');
  for (const arch of fs.readdirSync(win32)) {
    if (arch !== 'x64') fs.rmSync(path.join(win32, arch), { recursive: true, force: true });
  }
}

/**
 * Pakete giden veritabanini HAZIRLA — canli dosyayi oldugu gibi kopyalama.
 *
 * NEDEN: `data/vectors.db` yalnizca vektor indeksi degil; Sprint 1'den beri
 * kullanici hesaplarini (parola ozetleriyle), denetim kaydini ve Sprint 4'ten
 * beri yanitsiz soru metinlerini de tasiyor. Duz kopyalama, paketi alan HERKESE
 * bu makinede kimin hangi soruyu sordugunu ve yonetici hesabinin parola ozetini
 * verir. Olculdu: canli veritabaninda 1 hesap (e-posta adresi kullanici adi),
 * 100 denetim satiri, 4 bosluk kaydi.
 *
 * Paketi alan kisi KENDI kurulumunu yapar: uygulama hic kullanici yoksa ilk
 * kurulum ekranini gosterir (bkz. auth.route.ts). Yani hesaplarin gitmesi
 * gereksiz oldugu kadar zararli.
 *
 * NE KALIR: `chunks` (hazir vektor indeksi — paketin internet olmadan calismasi
 * buna bagli), `documents` (erisim etiketleri) ve `document_versions`. Surumler
 * kaliyor ki yanit altindaki "... tarihli surume dayanmaktadir" bildirimi ilk
 * calistirmada calissin; ama `created_by` alanindaki kullanici adi 'kurulum'
 * ile degistiriliyor.
 *
 * NASIL: once `VACUUM INTO` ile tutarli bir kopya alinir (dosya baska bir surec
 * tarafindan aciksa bile guvenli), sonra kopya temizlenir. Denetim kaydinin
 * silinme tetikleyicisi kopyada dusurulur — bu bir TUREV artefakt, kaydin
 * kendisi degil. Tetikleyiciler `CREATE TRIGGER IF NOT EXISTS` oldugu icin
 * uygulama ilk aciliste hepsini yeniden kurar.
 */
const paketVeritabani = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });

  const kaynak = new DatabaseSync(src, { readOnly: true });
  kaynak.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  kaynak.close();

  // Yabanci anahtar zorlamasi KAPALI: node:sqlite bunu varsayilan olarak acar ve
  // `audit_log.user_id -> users.id` yuzunden hesaplari silmeye izin vermez. Burada
  // butun tablolar birlikte bosaltiliyor, sira onemli degil.
  const kopya = new DatabaseSync(dest, { enableForeignKeyConstraints: false });
  for (const t of ['audit_no_delete', 'audit_no_update', 'versions_no_delete', 'versions_immutable']) {
    kopya.exec(`DROP TRIGGER IF EXISTS ${t}`);
  }

  const sayac = {};
  for (const tablo of ['users', 'sessions', 'audit_log', 'unanswered_questions']) {
    // Tablo yoksa sayim asamasinda hata verir ve o tabloyu atlariz. DELETE ise
    // AYRI dene/yakala icinde degil: gercek bir silme hatasi yutulmamali, cunku
    // yutulursa temizlenmemis veritabani paketlenmis olur.
    let n;
    try {
      n = kopya.prepare(`SELECT COUNT(*) n FROM ${tablo}`).get().n;
    } catch {
      continue; // tablo henuz olusmamis
    }
    sayac[tablo] = n;
    kopya.exec(`DELETE FROM ${tablo}`);
  }
  try {
    kopya.exec(`UPDATE document_versions SET created_by = 'kurulum'`);
  } catch {
    /* surum tablosu yoksa yapacak bir sey yok */
  }
  kopya.exec('VACUUM');

  const kalan = (t) => {
    try {
      return kopya.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    } catch {
      return 0;
    }
  };
  const parca = kalan('chunks');
  const surum = kalan('document_versions');

  // Temizlik dogrulanmadan paket yazilmis olmasin.
  for (const tablo of ['users', 'audit_log', 'unanswered_questions']) {
    if (kalan(tablo) !== 0) {
      kopya.close();
      throw new Error(`Paket veritabani temizlenemedi: ${tablo} hala dolu.`);
    }
  }
  kopya.close();

  const temizlenen = Object.entries(sayac)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}:${n}`)
    .join(' ');
  log(`     Veritabani hazirlandi — parca:${parca} surum:${surum}` +
      (temizlenen ? ` | temizlenen ${temizlenen}` : ' | temizlenecek kayit yoktu'));
};

// Arayuz + veri
copyDir(path.join(ROOT, 'client', 'dist'), path.join(OUT, 'public'));
copyDir(path.join(ROOT, 'data', 'corpus'), path.join(OUT, 'data', 'corpus'));
if (fs.existsSync(path.join(ROOT, 'data', 'vectors.db'))) {
  paketVeritabani(path.join(ROOT, 'data', 'vectors.db'), path.join(OUT, 'data', 'vectors.db'));
}
if (fs.existsSync(path.join(ROOT, '.env.local'))) {
  fs.copyFileSync(path.join(ROOT, '.env.local'), path.join(OUT, '.env.local'));
}

// OCR dil verisi. ocr.service bunu REPO_ROOT/vendor/tessdata altinda arar;
// paketlenmis modda REPO_ROOT exe'nin bulundugu dizindir.
const tessSrc = path.join(SERVER, 'vendor', 'tessdata');
if (fs.existsSync(tessSrc)) {
  copyDir(tessSrc, path.join(OUT, 'vendor', 'tessdata'));
  log('     OCR dil verisi kopyalandi (tur.traineddata)');
} else {
  log('     UYARI: OCR dil verisi bulunamadi — taranmis PDF destegi calismayacak.');
}

// ----------------------------------------------------------------- 5) ozet
log('5/5  Tamamlandi.\n');

const dirSize = (p) =>
  fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
    const full = path.join(p, e.name);
    return sum + (e.isDirectory() ? dirSize(full) : fs.statSync(full).size);
  }, 0);

console.log(`  Cikti klasoru : ${OUT}`);
console.log(`  PrivateHrRag.exe : ${(fs.statSync(exePath).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  Toplam           : ${(dirSize(OUT) / 1024 / 1024).toFixed(1)} MB`);
console.log('\n  Calistirmak icin: dist-app\\PrivateHrRag.exe (cift tiklayin)\n');
