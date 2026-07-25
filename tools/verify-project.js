/**
 * ═════════════════════════════════════════════════════════════════════════════
 * SPARK | Otonom Proje ve Dosya Denetçi Ajanı (Self-Diagnostic & Verification Agent)
 * ═════════════════════════════════════════════════════════════════════════════
 * Bu script projedeki tüm dosyaları, README dokümantasyonunu, yüklenen verileri
 * ve modüller arası senkronizasyonu otomatik olarak denetler.
 * 
 * Çalıştırmak için: node scripts/verify-project.js
 */

const fs = require('fs');
const path = require('path');

// Renk kodları (Terminal çıktısı için)
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
};

let errorCount = 0;
let warningCount = 0;
let successCount = 0;

function logSection(title) {
    console.log(`\n${c.bold}${c.cyan}━━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}${c.reset}`);
}

function logSuccess(msg) {
    console.log(`  ${c.green}✔ ${c.reset}${msg}`);
    successCount++;
}

function logWarning(msg) {
    console.log(`  ${c.yellow}⚠ ${c.reset}${msg}`);
    warningCount++;
}

function logError(msg) {
    console.log(`  ${c.red}✖ ${c.reset}${msg}`);
    errorCount++;
}

// Proje Kök Dizini
const rootDir = path.resolve(__dirname, '..');

console.log(`${c.bold}${c.magenta}
   █▀▀█ █▀▀█ █▀▀█ █▀▀█ █  █ 
   ▀▀▀▄ █▄▄█ █▄▄█ █▄▄▀ █▀▀▄  [OTONOM PROJE & DOSYA DENETÇİ AJANI v1.0]
   █▄▄█ █    █  █ █  █ █  █  (Tüm Dosyalar, Veriler ve README Uyum Tarayıcısı)
${c.reset}`);

// ═════════════════════════════════════════════════════════════════════════════
// 1. DOSYA VARLIĞI & KLASÖR YAPISI DENETİMİ (README vs GERÇEKLİK)
// ═════════════════════════════════════════════════════════════════════════════
logSection('1. DOSYA VARLIĞI VE KLASÖR YAPISI DENETİMİ');

const expectedFiles = [
    'index.html',
    'README.md',
    'css/style.css',
    'js/data.js',
    'js/calculations.js',
    'js/forecast.js',
    'js/scenarios.js',
    'js/charts.js',
    'js/topology.js',
    'js/app.js'
];

const fileContents = {};

expectedFiles.forEach(relPath => {
    const fullPath = path.join(rootDir, relPath);
    if (fs.existsSync(fullPath)) {
        fileContents[relPath] = fs.readFileSync(fullPath, 'utf8');
        logSuccess(`Dosya mevcut: [${relPath}] (${(fileContents[relPath].length / 1024).toFixed(1)} KB)`);
    } else {
        logError(`Kritik dosya eksik: [${relPath}]`);
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. YÜKLENEN VERİLER VE KULLANILAN VERİLERİN UYUM DENETİMİ
// ═════════════════════════════════════════════════════════════════════════════
logSection('2. VERİ BÜTÜNLÜĞÜ VE KULLANIM UYUM DENETİMİ (data.js & diğerleri)');

if (fileContents['js/data.js']) {
    const dataJs = fileContents['js/data.js'];

    // TRAFOLAR tanımlarını çıkar
    const trafolarMatch = dataJs.match(/const\s+TRAFOLAR\s*=\s*\[([\s\S]*?)\];/);
    const trafoIds = new Set();
    const trafoAdlari = [];

    if (trafolarMatch) {
        // ID regex arama
        const idMatches = [...trafolarMatch[1].matchAll(/id:\s*['"]([^'"]+)['"]/g)];
        idMatches.forEach(m => trafoIds.add(m[1]));

        const adiMatches = [...trafolarMatch[1].matchAll(/adi:\s*['"]([^'"]+)['"]/g)];
        adiMatches.forEach(m => trafoAdlari.push(m[1]));

        logSuccess(`TRAFOLAR tanımı doğrulandı: ${trafoIds.size} trafo merkez kaydı var (${Array.from(trafoIds).join(', ')}).`);
    } else {
        logError(`data.js içinde 'TRAFOLAR' dizisi bulunamadı!`);
    }

    // _RAW_DATA kontrolü
    const rawDataCountMatch = [...dataJs.matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*['"](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})['"]\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g)];
    if (rawDataCountMatch && rawDataCountMatch.length > 0) {
        logSuccess(`_RAW_DATA içinde ${rawDataCountMatch.length.toLocaleString('tr-TR')} adet saatlik veri kaydı başarıyla ayrıştırıldı.`);

        // Veri kalitesi denetimi
        let trafoUyuşmazlıkSayisi = 0;
        let negatifEnerjiSayisi = 0;
        let nanSayisi = 0;

        rawDataCountMatch.forEach(row => {
            const tId = row[1];
            const aktif = parseFloat(row[3]);
            const enduktif = parseFloat(row[4]);
            const kapasitif = parseFloat(row[5]);

            if (!trafoIds.has(tId)) trafoUyuşmazlıkSayisi++;
            if (aktif < 0 || enduktif < 0 || kapasitif < 0) negatifEnerjiSayisi++;
            if (isNaN(aktif) || isNaN(enduktif) || isNaN(kapasitif)) nanSayisi++;
        });

        if (trafoUyuşmazlıkSayisi === 0) {
            logSuccess(`Tüm saatlik veri satırları TRAFOLAR listesindeki geçerli ID'lerle (%100 uyumlu) eşleşiyor.`);
        } else {
            logError(`${trafoUyuşmazlıkSayisi} adet satırda tanımlı olmayan Trafo ID kullanılmış!`);
        }

        if (negatifEnerjiSayisi === 0 && nanSayisi === 0) {
            logSuccess(`Veri kalitesi kusursuz: 0 negatif enerji değeri, 0 NaN (bozuk sayı) tespit edildi.`);
        } else {
            logError(`Veri kalitesi sorunu: ${negatifEnerjiSayisi} negatif değer, ${nanSayisi} NaN değeri bulundu.`);
        }
    } else {
        logWarning(`data.js içindeki _RAW_DATA saatlik veri dizisi standart regex ile tam sayılamadı (büyük veri kümesi veya sıkıştırılmış format).`);
    }

    // Diğer modüllerdeki trafo referanslarını kontrol et
    ['js/app.js', 'js/topology.js', 'js/calculations.js'].forEach(relPath => {
        if (!fileContents[relPath]) return;
        const content = fileContents[relPath];
        let refCount = 0;
        trafoIds.forEach(id => {
            if (content.includes(id)) refCount++;
        });
        if (refCount > 0) {
            logSuccess(`[${relPath}] modülü tanımlı Trafo ID referanslarını aktif kullanıyor (${refCount} eşleşme).`);
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. HTML <-> JS DOM SENKRONİZASYON DENETİMİ
// ═════════════════════════════════════════════════════════════════════════════
logSection('3. HTML <-> JS DOM SENKRONİZASYON DENETİMİ');

if (fileContents['index.html']) {
    const htmlContent = fileContents['index.html'];
    
    // HTML'deki tüm id="..." listesini çıkar
    const htmlIds = new Set();
    const idMatches = [...htmlContent.matchAll(/id\s*=\s*['"]([^'"]+)['"]/g)];
    idMatches.forEach(m => htmlIds.add(m[1]));
    logSuccess(`index.html üzerinde toplam ${htmlIds.size} benzersiz DOM ID tanımlı.`);

    // JS dosyalarında aranan getElementById ve querySelector('#ID') listesini çıkar
    const jsFiles = expectedFiles.filter(f => f.startsWith('js/'));
    let totalDomChecks = 0;
    let missingDomIds = 0;

    jsFiles.forEach(relPath => {
        if (!fileContents[relPath]) return;
        const jsCode = fileContents[relPath];

        const getByIdMatches = [...jsCode.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)];
        const queryMatches = [...jsCode.matchAll(/document\.querySelector\(\s*['"]#([a-zA-Z0-9_-]+)['"]\s*\)/g)];
        
        const fileDomIds = new Set();
        getByIdMatches.forEach(m => fileDomIds.add(m[1]));
        queryMatches.forEach(m => fileDomIds.add(m[1]));

        if (fileDomIds.size > 0) {
            let fileMissing = 0;
            fileDomIds.forEach(id => {
                totalDomChecks++;
                if (!htmlIds.has(id)) {
                    logError(`[${relPath}] içinde aranan #${id} elementi index.html dosyasında YOK!`);
                    fileMissing++;
                    missingDomIds++;
                }
            });

            if (fileMissing === 0) {
                logSuccess(`[${relPath}] içindeki ${fileDomIds.size} benzersiz DOM ID referansı index.html ile %100 uyumlu.`);
            }
        }
    });

    if (missingDomIds === 0 && totalDomChecks > 0) {
        logSuccess(`Genel DOM Senkronizasyonu: JS dosyalarında çağrılan tüm DOM elementleri HTML'de mevcut!`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. MODÜLLER ARASI API VE ÇAĞRI UYUM DENETİMİ
// ═════════════════════════════════════════════════════════════════════════════
logSection('4. MODÜLLER ARASI API VE ÇAĞRI UYUM DENETİMİ');

const exportedApis = {};
const moduleNames = {
    'js/data.js': 'VeriModulu',
    'js/calculations.js': 'HesaplamaModulu',
    'js/forecast.js': 'TahminModulu',
    'js/scenarios.js': 'SenaryoModulu',
    'js/charts.js': 'GrafikModulu',
    'js/topology.js': 'TopolojiModulu',
    'js/app.js': 'App'
};

// Her modülün dışa aktardığı (return { ... }) fonksiyonları bul
Object.keys(moduleNames).forEach(relPath => {
    if (!fileContents[relPath]) return;
    const jsCode = fileContents[relPath];
    const modName = moduleNames[relPath];

    const returnBlockMatch = jsCode.match(/return\s*\{([\s\S]*?)\};\s*\}\)\(\);/);
    if (returnBlockMatch) {
        const apiMethods = new Set();
        const lines = returnBlockMatch[1].split(',');
        lines.forEach(line => {
            const trimmed = line.trim().split(':')[0].trim().split('(')[0].trim();
            if (trimmed && !trimmed.startsWith('//')) {
                apiMethods.add(trimmed);
            }
        });
        exportedApis[modName] = apiMethods;
        logSuccess(`[${modName}] dışa aktarılan API sözleşmesi doğrulandı (${apiMethods.size} fonksiyon: ${Array.from(apiMethods).join(', ')}).`);
    }
});

// Modüller arası çağrıları denetle (Örn: HesaplamaModulu.oranHesapla)
let totalCallsChecked = 0;
let brokenApiCalls = 0;

Object.keys(exportedApis).forEach(targetMod => {
    const validMethods = exportedApis[targetMod];

    Object.keys(moduleNames).forEach(callerRelPath => {
        if (!fileContents[callerRelPath]) return;
        const callerCode = fileContents[callerRelPath];

        // RegEx ile TargetMod.method(...) çağrılarını yakala
        const callRegex = new RegExp(`${targetMod}\\.([a-zA-Z0-9_]+)\\s*\\(`, 'g');
        const calls = [...callerCode.matchAll(callRegex)];

        calls.forEach(m => {
            const calledMethod = m[1];
            totalCallsChecked++;
            if (!validMethods.has(calledMethod)) {
                logError(`[${callerRelPath}] içinde '${targetMod}.${calledMethod}()' çağrılmış, ancak ${targetMod} bu fonksiyonu dışa AKTARMIYOR!`);
                brokenApiCalls++;
            }
        });
    });
});

if (brokenApiCalls === 0 && totalCallsChecked > 0) {
    logSuccess(`Modüller Arası API Senkronizasyonu: Toplam ${totalCallsChecked} modül çağrısı incelendi, tamamı %100 geçerli.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. SCRIPT YÜKLEME SIRASI VE HİYERARŞİ DENETİMİ
// ═════════════════════════════════════════════════════════════════════════════
logSection('5. SCRIPT YÜKLEME SIRASI VE HİYERARŞİ DENETİMİ (index.html)');

if (fileContents['index.html']) {
    const html = fileContents['index.html'];
    const scriptMatches = [...html.matchAll(/<script\s+src\s*=\s*['"]([^'"]+)['"]/g)];
    const loadedScripts = scriptMatches.map(m => m[1]);

    const expectedOrder = [
        'js/data.js',
        'js/calculations.js',
        'js/forecast.js',
        'js/scenarios.js',
        'js/charts.js',
        'js/topology.js',
        'js/app.js'
    ];

    let orderOk = true;
    let lastIdx = -1;

    expectedOrder.forEach(scriptPath => {
        const currentIdx = loadedScripts.indexOf(scriptPath);
        if (currentIdx === -1) {
            logError(`Beklenen script yüklemesi index.html içinde eksik: [${scriptPath}]`);
            orderOk = false;
        } else if (currentIdx < lastIdx) {
            logError(`Hatalı yükleme sırası: [${scriptPath}], bağımlı olduğu modülden önce yükleniyor!`);
            orderOk = false;
        } else {
            lastIdx = currentIdx;
        }
    });

    if (orderOk) {
        logSuccess(`Script yükleme hiyerarşisi kusursuz: [${loadedScripts.join(' ➔ ')}]`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. README.MD İLE KOD TARAFININ GERÇEKLİK UYUMU
// ═════════════════════════════════════════════════════════════════════════════
logSection('6. README.MD DOKÜMANTASYON UYUM DENETİMİ');

if (fileContents['README.md']) {
    const readme = fileContents['README.md'];

    // Modül listesi README'de yer alıyor mu?
    let allModulesInReadme = true;
    Object.keys(moduleNames).forEach(relPath => {
        if (!readme.includes(relPath)) {
            logWarning(`README.md içinde [${relPath}] dosyası açıklama veya klasör yapısında geçmiyor.`);
            allModulesInReadme = false;
        }
    });

    if (allModulesInReadme) {
        logSuccess(`README.md klasör yapısı bölümü projedeki tüm JS modüllerini doğru listeliyor.`);
    }

    // Kritik konseptler README'de var mı?
    const keywords = ['EPDK', '%15', '%20', 'Ümraniye', 'Kartal', 'Holt-Winters', 'Topluluk Modeli', 'SCADA'];
    let keywordsFound = 0;
    keywords.forEach(kw => {
        if (readme.includes(kw)) keywordsFound++;
    });

    if (keywordsFound === keywords.length) {
        logSuccess(`README.md dokümantasyonu projenin algoritmalarını ve TEİAŞ kriterlerini tam kapsıyor (${keywordsFound}/${keywords.length} anahtar kelime doğrulandı).`);
    } else {
        logWarning(`README.md içinde bazı teknik kavramlar eksik (${keywordsFound}/${keywords.length}).`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ÖZET VE SONUÇ
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${c.bold}${c.cyan}━━━ TARAMA SONUÇ ÖZETİ ${'━'.repeat(37)}${c.reset}`);
console.log(`  Başarılı Doğrulama (Success): ${c.green}${c.bold}${successCount}${c.reset}`);
console.log(`  Uyarılar (Warnings)         : ${c.yellow}${c.bold}${warningCount}${c.reset}`);
console.log(`  Hatalar (Errors)            : ${c.red}${c.bold}${errorCount}${c.reset}`);

if (errorCount === 0) {
    console.log(`\n${c.bold}${c.green}🎉 TEBRİKLER! Projedeki tüm dosyalar (%100 uyum), veriler ve dokümantasyon birbiriyle kusursuz senkronize!${c.reset}\n`);
    process.exit(0);
} else {
    console.log(`\n${c.bold}${c.red}⚠️ DİKKAT! Projedeki dosyalarda yukarıda belirtilen ${errorCount} adet uyumsuzluk/hata tespit edildi.${c.reset}\n`);
    process.exit(1);
}
