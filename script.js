let state = {
    count: 2,
    files: new Array(2).fill(null),
    usageCount: 0
};

state.cache = {};

const MAX_LCS_OPERATIONS = 5_000_000;

const elements = {
    select: document.getElementById('submission-count'),
    grid: document.getElementById('upload-grid'),
    btnCompare: document.getElementById('btn-compare'),
    errorMsg: document.getElementById('error-msg'),
    results: document.getElementById('results-container'),
    searchCountInfo: document.getElementById('global-search-count'),
};

function init() {
    const stored = localStorage.getItem('docComparePro_usage');
    state.usageCount = stored ? parseInt(stored, 10) : 0;
    if (elements.searchCountInfo) {
        elements.searchCountInfo.textContent = state.usageCount;
    }

    renderUploadSlots(state.count);
    setupEventListeners();
}

function setupEventListeners() {
    elements.select.addEventListener('change', (e) => {
        const newCount = parseInt(e.target.value);
        updateSlotCount(newCount);
    });

    elements.btnCompare.addEventListener('click', () => {
        if (validateInputs()) {
            performComparison();
        }
    });

    elements.grid.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
            const index = parseInt(e.target.dataset.index);
            const file = e.target.files[0];
            handleFileSelect(index, file);
        }
    });
}

function updateSlotCount(newCount) {
    const newFiles = new Array(newCount).fill(null);
    for (let i = 0; i < Math.min(state.count, newCount); i++) {
        newFiles[i] = state.files[i];
    }
    state.files = newFiles;
    state.count = newCount;
    renderUploadSlots(newCount);
    validateInputs();
}

function renderUploadSlots(n) {
    elements.grid.innerHTML = '';

    for (let i = 0; i < n; i++) {
        const fileData = state.files[i];
        const isFilled = !!fileData;

        const card = document.createElement('div');
        card.className = 'upload-card';
        card.style.animationDelay = `${i * 50}ms`;

        card.innerHTML = `
            <div class="card-header">
                <span class="card-title">Document ${i + 1}</span>
                <div class="file-status ${isFilled ? 'active' : ''}"></div>
            </div>
            <label class="drop-zone">
                <input type="file" data-index="${i}" accept=".txt,.pdf,.docx,.js,.html,.css,.md,.json,.jpg,.jpeg,.png,.gif,*/*">
                <div class="upload-icon">${isFilled ? '📄' : '☁️'}</div>
                <div class="file-name">${isFilled ? fileData.name : 'Click to Upload'}</div>
                <div class="file-meta">${isFilled ? 'Ready' : 'Supports all text docs'}</div>
            </label>
        `;
        elements.grid.appendChild(card);
    }
}

function handleFileSelect(index, file) {
    if (!file) {
        state.files[index] = null;
        renderUploadSlots(state.count);
        validateInputs();
        return;
    }

    const reader = new FileReader();

    reader.onload = async (e) => {
        const buffer = e.target.result;
        const view = new Uint8Array(buffer);
        let processedContent = "";

        const ext = (file.name || '').split('.').pop().toLowerCase();
        let images = [];

        try {
            if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                const dataUrl = await new Promise(resolve => {
                    const r = new FileReader();
                    r.onload = e => resolve(e.target.result);
                    r.readAsDataURL(file);
                });
                processedContent = "";
                images.push(dataUrl);
            } else if (ext === 'pdf' || file.type === 'application/pdf') {
                if (window.pdfjsLib) {
                    try {
                        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        }
                        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
                        let fullText = '';
                        for (let p = 1; p <= pdf.numPages; p++) {
                            const page = await pdf.getPage(p);
                            const content = await page.getTextContent();

                            let lastY = -1;
                            let text = '';
                            // Sort items by Y descending (top to bottom), then X ascending
                            // Although pdf.js usually returns them somewhat ordered, sorting helps reliability
                            const items = content.items.sort((a, b) => {
                                if (Math.abs(a.transform[5] - b.transform[5]) > 4) {
                                    return b.transform[5] - a.transform[5]; // Higher Y first
                                }
                                return a.transform[4] - b.transform[4]; // Lower X first
                            });

                            for (const item of items) {
                                if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                                    text += '\n';
                                } else if (text.length > 0 && !text.endsWith('\n') && !text.endsWith(' ')) {
                                    text += ' ';
                                }
                                text += item.str;
                                lastY = item.transform[5];
                            }
                            fullText += text + '\n\n';
                        }
                        processedContent = fullText;
                    } catch (err) {
                        console.warn('PDF extraction failed, falling back to binary strings', err);
                        const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                        processedContent = extractStringsFromBinary(binaryStr);
                    }
                } else {
                    const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                    processedContent = extractStringsFromBinary(binaryStr);
                }
            } else if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                if (window.JSZip) {
                    try {
                        const zip = await JSZip.loadAsync(buffer);
                        const docXmlFile = zip.file('word/document.xml');
                        if (docXmlFile) {
                            const xml = await docXmlFile.async('string');
                            // Replace paragraph endings and breaks with newlines to preserve structure
                            const preservedStructure = xml
                                .replace(/<\/w:p>/g, '\n')
                                .replace(/<w:br\/>/g, '\n');
                            // Remove all other XML tags
                            processedContent = preservedStructure.replace(/<[^>]+>/g, '').trim();
                        } else {
                            const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                            processedContent = extractStringsFromBinary(binaryStr);
                        }
                    } catch (err) {
                        console.warn('DOCX extraction failed, falling back to binary strings', err);
                        const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                        processedContent = extractStringsFromBinary(binaryStr);
                    }
                } else {
                    const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                    processedContent = extractStringsFromBinary(binaryStr);
                }
            } else {
                let isBinaryFile = false;
                const checkLimit = Math.min(view.length, 1000);
                for (let i = 0; i < checkLimit; i++) {
                    if (view[i] === 0) {
                        isBinaryFile = true;
                        break;
                    }
                }

                if (isBinaryFile) {
                    const binaryStr = new TextDecoder('iso-8859-1').decode(view);
                    processedContent = extractStringsFromBinary(binaryStr);
                } else {
                    try {
                        processedContent = new TextDecoder('utf-8').decode(view);
                    } catch (err) {
                        processedContent = new TextDecoder('iso-8859-1').decode(view);
                    }
                }
            }
        } catch (err) {
            console.error('Error processing file', err);
            const binaryStr = new TextDecoder('iso-8859-1').decode(view);
            processedContent = extractStringsFromBinary(binaryStr);
        }

        if (ext === 'docx' && window.JSZip) {
            try {
                const zip = await JSZip.loadAsync(buffer);
                const mediaFolder = zip.folder("word/media");
                if (mediaFolder) {
                    const fileKeys = [];
                    mediaFolder.forEach((relativePath, file) => fileKeys.push({ path: relativePath, file: file }));

                    for (const item of fileKeys) {
                        const b64 = await item.file.async("base64");
                        let mime = 'image/png';
                        if (item.path.match(/\.jpe?g$/i)) mime = 'image/jpeg';
                        else if (item.path.match(/\.gif$/i)) mime = 'image/gif';
                        else if (item.path.match(/\.svg$/i)) mime = 'image/svg+xml';
                        images.push(`data:${mime};base64,${b64}`);
                    }
                }
            } catch (err) {
                console.warn("Image extraction failed", err);
            }
        }

        state.files[index] = {
            name: file.name,
            content: processedContent,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            images: images
        };

        renderUploadSlots(state.count);
        validateInputs();
        showError('');
    };

    reader.onerror = () => {
        showError(`Error reading file ${file.name}`);
    };

    reader.readAsArrayBuffer(file);
}

function isBinary(str) {
    const sample = str.slice(0, 1000);
    let suspicious = 0;
    for (let i = 0; i < sample.length; i++) {
        const code = sample.charCodeAt(i);
        if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
            suspicious++;
        }
    }
    return (suspicious / sample.length) > 0.1;
}

function extractStringsFromBinary(binaryStr) {
    const regex = /[A-Za-z0-9\s\.,;:!?'"()\[\]\{\}\-\_\/\\]{4,}/g;
    const matches = binaryStr.match(regex);
    if (!matches) return "[No readable text found in binary file]";
    return matches.join('\n');
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function validateInputs() {
    const filledCount = state.files.filter(f => f !== null).length;
    elements.btnCompare.disabled = filledCount < 2;
    return filledCount >= 2;
}

function showError(msg) {
    elements.errorMsg.textContent = msg;
    elements.errorMsg.className = `error-msg ${msg ? 'visible' : ''}`;
}

async function performComparison() {
    elements.results.innerHTML = '';

    state.usageCount++;
    localStorage.setItem('docComparePro_usage', state.usageCount);
    if (elements.searchCountInfo) {
        elements.searchCountInfo.textContent = state.usageCount;
    }

    const results = [];
    const spinnerHtml = `<div class="comparison-block" style="padding:2rem; text-align:center;"><div class="spinner" style="width:30px;height:30px;border-width:3px;"></div><div style="margin-top:1rem">Analyzing documents...</div></div>`;
    elements.results.innerHTML = spinnerHtml;
    elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });

    for (let i = 0; i < state.count - 1; i++) {
        const doc1 = state.files[i];
        if (!doc1) continue;
        for (let j = i + 1; j < state.count; j++) {
            const doc2 = state.files[j];
            if (!doc2) continue;

            let diffData;
            try {
                diffData = await AdvancedComparison.compare(doc1, doc2);
            } catch (err) {
                console.error("Comparison error", err);
                diffData = { matchPercent: 0, details: null, error: err.message };
            }

            results.push({ i: i + 1, j: j + 1, name1: doc1.name, name2: doc2.name, diffData });
        }
    }

    elements.results.innerHTML = '';

    if (results.length === 0) {
        elements.results.innerHTML = `<div class="comparison-block" style="padding:2rem; text-align:center; color:#ccc">No comparisons to perform. Upload at least two documents.</div>`;
        return;
    }

    const summaryBlock = document.createElement('div');
    summaryBlock.className = 'comparison-block';
    let summaryHtml = `<div class="comparison-header"><div class="comp-title"><strong>Pairwise Match Summary</strong></div></div>`;
    summaryHtml += '<div style="padding:1rem 1.5rem; color:var(--text-muted)">';
    summaryHtml += '<table style="width:100%; border-collapse:collapse">';
    summaryHtml += '<thead><tr style="text-align:left; border-bottom:1px solid var(--border)"><th style="padding:0.5rem">Pair</th><th style="padding:0.5rem">Document A</th><th style="padding:0.5rem">Document B</th><th style="padding:0.5rem">Match</th></tr></thead>';
    summaryHtml += '<tbody>';
    results.forEach(r => {
        const percent = r.diffData.matchPercent;
        const safeA = escapeHTML(r.name1);
        const safeB = escapeHTML(r.name2);
        summaryHtml += `<tr><td style="padding:0.5rem; vertical-align:top">${r.i} ↔ ${r.j}</td><td style="padding:0.5rem">Document ${r.i} — ${safeA}</td><td style="padding:0.5rem">Document ${r.j} — ${safeB}</td><td style="padding:0.5rem"><strong>${percent}%</strong></td></tr>`;
    });
    summaryHtml += '</tbody></table></div>';
    summaryBlock.innerHTML = summaryHtml;
    elements.results.appendChild(summaryBlock);

    results.forEach(r => {
        renderComparisonResult(r.name1, r.name2, r.diffData, r.i, r.j);
    });
}

function computeDiff(text1, text2) {
    const lines1 = text1.split(/\r?\n/);
    const lines2 = text2.split(/\r?\n/);

    const matchP = data.stats ? data.stats.matchPercent : 0;
    const isPerfect = matchP === 100;

    const header = `
        <div class="comparison-header">
            <div class="comp-title">
                <span style="color:var(--text-muted)">Comparing:</span> 
                <strong>${safeName1}</strong> <span style="color:var(--primary); margin:0 0.5rem">↔</span> <strong>${safeName2}</strong>
            </div>
            <div class="comp-stats">
                <div class="stat-pill match">
                    <span style="font-size:1.2em; margin-right:0.25rem">${isPerfect ? '✅' : '📊'}</span>
                    ${matchP}% Match
                </div>
                <div class="stat-pill added">+${data.stats ? data.stats.added : 0} Lines</div>
                <div class="stat-pill removed">-${data.stats ? data.stats.removed : 0} Lines</div>
            </div>
        </div>
    `;

    if (data.diff && data.diff.length > 0) {
        let diffHtml = '<div class="diff-viewer">';
        data.diff.forEach((line, idx) => {
            const safeContent = (line.content || '')
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            diffHtml += `
                <div class="diff-line ${line.type}">
                    <div class="line-num">${idx + 1}</div>
                    <div class="line-content">${safeContent || ' '}</div> 
                </div>
            `;
        });
        diffHtml += '</div>';
        block.innerHTML = header + diffHtml;
        elements.results.appendChild(block);
        return;
    }

    const summaryHtml = `<div class="diff-viewer" style="padding:1rem 1.25rem; color:var(--text-muted)"><div>Summary only — detailed diff not computed.</div></div>`;
    block.innerHTML = header + summaryHtml;

    const btnWrap = document.createElement('div');
    btnWrap.style.padding = '1rem 1.25rem';
    const detailsBtn = document.createElement('button');
    detailsBtn.textContent = 'Show Details';
    detailsBtn.className = 'btn-compare';
    detailsBtn.style.padding = '0.4rem 1rem';
    detailsBtn.style.borderRadius = '8px';
    detailsBtn.addEventListener('click', () => {
        let idxA = -1, idxB = -1;
        for (let k = 0; k < state.files.length; k++) {
            if (state.files[k] && state.files[k].name === name1 && idxA === -1) idxA = k + 1;
            else if (state.files[k] && state.files[k].name === name2 && idxB === -1) idxB = k + 1;
        }
        if (idxA === -1 || idxB === -1) return;

        detailsBtn.disabled = true;
        detailsBtn.textContent = 'Computing...';

        const docA = state.files[idxA - 1];
        const docB = state.files[idxB - 1];
        const n = docA.content.split(/\r?\n/).length;
        const m = docB.content.split(/\r?\n/).length;

        if (n * m <= MAX_LCS_OPERATIONS) {
            let detailed;
            try {
                detailed = computeDiffDetailed(idxA, idxB);
            } catch (err) {
                console.error('Error computing detailed diff', err);
                detailsBtn.textContent = 'Error';
                return;
            }

            if (detailed) {
                let dh = header;
                let diffHtml = '<div class="diff-viewer">';
                detailed.diff.forEach((line, idx) => {
                    const safeContent = (line.content || '')
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");

                    diffHtml += `
                        <div class="diff-line ${line.type}">
                            <div class="line-num">${idx + 1}</div>
                            <div class="line-content">${safeContent || ' '}</div> 
                        </div>
                    `;
                });
                diffHtml += '</div>';
                block.innerHTML = dh + diffHtml;
            }
            return;
        }

        detailsBtn.disabled = true;
        detailsBtn.textContent = '';
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        spinner.style.marginLeft = '0.5rem';
        detailsBtn.appendChild(spinner);

        const workerBlobUrl = 'lcs-worker.js';
        try {
            const worker = new Worker(workerBlobUrl);
            const requestId = `${idxA}_${idxB}_${Date.now()}`;
            worker.postMessage({ id: requestId, textA: docA.content, textB: docB.content });
            worker.addEventListener('message', (ev) => {
                const result = ev.data.result;
                state.cache[`${idxA}_${idxB}`] = result;

                const dh = header;
                let diffHtml = '<div class="diff-viewer">';
                result.diff.forEach((line, idx) => {
                    const safeContent = (line.content || '')
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
                    diffHtml += `
                        <div class="diff-line ${line.type}">
                            <div class="line-num">${idx + 1}</div>
                            <div class="line-content">${safeContent || ' '}</div> 
                        </div>
                    `;
                });
                diffHtml += '</div>';
                block.innerHTML = dh + diffHtml;
                worker.terminate();
            });
        } catch (err) {
            console.error('Worker failed, fallback to main thread', err);
            try {
                const detailed = computeDiffDetailed(idxA, idxB);
                if (detailed) {
                    let dh = header;
                    let diffHtml = '<div class="diff-viewer">';
                    detailed.diff.forEach((line, idx) => {
                        const safeContent = (line.content || '')
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");
                        diffHtml += `
                            <div class="diff-line ${line.type}">
                                <div class="line-num">${idx + 1}</div>
                                <div class="line-content">${safeContent || ' '}</div> 
                            </div>
                        `;
                    });
                    diffHtml += '</div>';
                    block.innerHTML = dh + diffHtml;
                }
            } catch (err2) {
                console.error('Fallback detailed diff failed', err2);
                detailsBtn.textContent = 'Error';
            }
        }
    });

    btnWrap.appendChild(detailsBtn);
    block.appendChild(btnWrap);
    elements.results.appendChild(block);
}

function computeApproximateSimilarity(text1, text2) {
    const lines1 = text1.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const lines2 = text2.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    const set1 = new Set(lines1);
    const set2 = new Set(lines2);
    let intersection = 0;
    if (set1.size <= set2.size) {
        for (const l of set1) if (set2.has(l)) intersection++;
    } else {
        for (const l of set2) if (set1.has(l)) intersection++;
    }

    const len1 = lines1.length;
    const len2 = lines2.length;
    const maxLen = Math.max(len1, len2) || 1;
    const percent = Math.round((intersection / maxLen) * 100);

    return {
        approx: true,
        stats: {
            matchPercent: percent,
            added: Math.max(0, len2 - intersection),
            removed: Math.max(0, len1 - intersection),
            matching: intersection
        },
        diff: []
    };
}

function computeDiffDetailed(indexA, indexB) {
    const key = `${indexA}_${indexB}`;
    const cacheKeyRev = `${indexB}_${indexA}`;
    if (state.cache[key]) return state.cache[key];
    if (state.cache[cacheKeyRev]) return state.cache[cacheKeyRev];

    const docA = state.files[indexA - 1];
    const docB = state.files[indexB - 1];
    if (!docA || !docB) return null;

    const text1 = docA.content;
    const text2 = docB.content;

    const lines1 = text1.split(/\r?\n/);
    const lines2 = text2.split(/\r?\n/);

    const n = lines1.length;
    const m = lines2.length;
    const matrix = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (lines1[i - 1] === lines2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }

    const diff = [];
    let i = n, j = m;
    let matchingLines = 0;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
            diff.unshift({ type: 'same', content: lines1[i - 1] });
            matchingLines++;
            i--; j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            diff.unshift({ type: 'added', content: lines2[j - 1] });
            j--;
        } else {
            diff.unshift({ type: 'removed', content: lines1[i - 1] });
            i--;
        }
    }

    const maxLen = Math.max(n, m);
    const percent = maxLen === 0 ? 100 : Math.round((matchingLines / maxLen) * 100);

    const result = {
        diff,
        stats: {
            matchPercent: percent,
            added: diff.filter(l => l.type === 'added').length,
            removed: diff.filter(l => l.type === 'removed').length,
            matching: matchingLines
        }
    };

    state.cache[key] = result;
    return result;
}

function renderComparisonResult(name1, name2, data, idx1, idx2) {
    const block = document.createElement('div');
    block.className = 'comparison-block';

    const matchP = data.matchPercent;
    const isPerfect = matchP === 100;

    const textStats = data.details.text.stats;

    const safeName1 = escapeHTML(name1);
    const safeName2 = escapeHTML(name2);
    const labelA = idx1 ? `Document ${idx1} — ` : '';
    const labelB = idx2 ? `Document ${idx2} — ` : '';

    const header = `
        <div class="comparison-header">
            <div class="comp-title">
                <span style="color:var(--text-muted)">Comparing:</span>
                <strong>${labelA}${safeName1}</strong> <span style="color:var(--primary); margin:0 0.5rem">↔</span> <strong>${labelB}${safeName2}</strong>
            </div>
            <div class="comp-stats">
                <div class="stat-pill match">
                    <span style="font-size:1.2em; margin-right:0.25rem">${isPerfect ? '✅' : '📊'}</span>
                    ${matchP}% Match
                </div>
                <div class="stat-pill added">+${textStats.added} Lines</div>
                <div class="stat-pill removed">-${textStats.removed} Lines</div>
            </div>
        </div>
    `;

    let contentHtml = '';

    const textDiff = data.details.text;
    if (textDiff && textDiff.diff) {
        const jaccard = data.details.jaccard || 0;
        const jaccardClass = jaccard > 80 ? 'text-success' : (jaccard > 50 ? 'text-warning' : 'text-danger');

        contentHtml += `
            <div class="layer-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span>Text Layer (Differences Only)</span>
                <span style="font-size:0.85rem; text-transform:none; opacity:0.9;">
                    Content Similarity: <strong class="${jaccardClass}">${jaccard}%</strong>
                </span>
            </div>`;

        if (jaccard > 80 && textDiff.stats.matchPercent < 70) {
            contentHtml += `<div class="diff-note" style="padding:0.5rem 1rem; color:var(--primary); font-size:0.85rem; background:rgba(255,153,0,0.1); border-bottom:1px solid rgba(255,153,0,0.2);">
                <span style="font-weight:bold">Note:</span> High content similarity detected (${data.details.jaccard}%) despite layout changes. The text is mostly the same, just reordered.
             </div>`;
        }

        const rows = generateSideBySideRows(textDiff.diff);
        const filteredRows = filterContextRows(rows, 2);

        if (filteredRows.length === 0) {
            contentHtml += '<div style="padding:1rem; color:var(--text-muted)">No text differences found.</div>';
        } else {
            contentHtml += '<div class="diff-viewer side-by-side"><div class="diff-table">';

            filteredRows.forEach(row => {
                if (row.isGap) {
                    contentHtml += `<div class="diff-gap">... ${row.count} matching lines hidden ...</div>`;
                } else {
                    contentHtml += '<div class="diff-row">';
                    if (row.left) {
                        const typeClass = row.left.type === 'removed' ? 'background:rgba(255,50,50,0.1); color:var(--diff-rem-text);' : '';
                        contentHtml += `<div class="diff-cell" style="${typeClass}">${escapeHTML(row.left.content)}</div>`;
                    } else {
                        contentHtml += `<div class="diff-cell empty"></div>`;
                    }

                    if (row.right) {
                        const typeClass = row.right.type === 'added' ? 'background:rgba(50,255,50,0.1); color:var(--diff-add-text);' : '';
                        contentHtml += `<div class="diff-cell" style="${typeClass}">${escapeHTML(row.right.content)}</div>`;
                    } else {
                        contentHtml += `<div class="diff-cell empty"></div>`;
                    }
                    contentHtml += '</div>';
                }
            });
            contentHtml += '</div></div>';
        }
    }

    const struct = data.details.structure;
    if (struct && struct.mismatches.length > 0) {
        const structLayerId = `struct-layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        contentHtml += `
            <div class="layer-header" style="display:flex; align-items:center; justify-content:space-between;">
                <span>Structured Data Layer (Mismatches)</span>
                <span class="view-toggle-icon" onclick="toggleStructLayer('${structLayerId}', this)" style="cursor:pointer; padding:4px;" title="Toggle View">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </span>
            </div>`;
        contentHtml += `<div id="${structLayerId}" class="diff-viewer" style="display:none;"><table style="width:100%; text-align:left; color: #ddd; border-collapse: collapse;">`;
        contentHtml += '<thead><tr style="border-bottom:1px solid #333"><th style="padding:0.5rem">Type</th><th style="padding:0.5rem">Value</th><th style="padding:0.5rem">Doc A Count</th><th style="padding:0.5rem">Doc B Count</th></tr></thead><tbody>';

        struct.mismatches.forEach(m => {
            contentHtml += `<tr style="background: rgba(255,100,0,0.1)">
                <td style="padding:0.5rem; text-transform:capitalize">${m.type}</td>
                <td style="padding:0.5rem">"${escapeHTML(m.value)}"</td>
                <td style="padding:0.5rem">${m.count1}</td>
                <td style="padding:0.5rem">${m.count2}</td>
            </tr>`;
        });
        contentHtml += '</tbody></table></div>';
    }

    const imgDiff = data.details.images;
    if (imgDiff && imgDiff.diffs.length > 0) {
        contentHtml += '<div class="layer-header">Image Layer (Visual Differences)</div>';
        contentHtml += '<div class="upload-grid" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:1rem; padding:1rem;">';
        imgDiff.diffs.forEach(d => {
            const sideLabel = d.side === 'left' ? 'Document A' : 'Document B';
            const color = d.side === 'left' ? 'var(--danger)' : 'var(--success)';
            contentHtml += `
                <div style="border:1px solid ${color}; padding:0.5rem; border-radius:8px; text-align:center;">
                    <div style="font-size:0.8rem; margin-bottom:0.5rem; color:${color}">${sideLabel} (Unique)</div>
                    <img src="${d.src}" style="max-width:100%; max-height:100px; border-radius:4px;">
                </div>
            `;
        });
        contentHtml += '</div>';
    }

    const metaDiff = data.details.meta;
    if (metaDiff && metaDiff.diffs.length > 0) {
        contentHtml += '<div class="layer-header">Metadata Layer</div>';
        contentHtml += '<div class="diff-viewer"><table style="width:100%; text-align:left; color: #ddd; border-collapse: collapse;">';
        contentHtml += '<thead><tr style="border-bottom:1px solid #333"><th style="padding:0.5rem">Property</th><th style="padding:0.5rem">Document A</th><th style="padding:0.5rem">Document B</th></tr></thead><tbody>';

        metaDiff.diffs.forEach(d => {
            contentHtml += `<tr>
                <td style="padding:0.5rem; font-weight:bold">${d.key}</td>
                <td style="padding:0.5rem; color:var(--text-muted)">${d.val1}</td>
                <td style="padding:0.5rem; color:var(--text-muted)">${d.val2}</td>
            </tr>`;
        });
        contentHtml += '</tbody></table></div>';
    }

    block.innerHTML = header + contentHtml;
    elements.results.appendChild(block);
}

function generateSideBySideRows(diff) {
    const rows = [];
    let leftNum = 1;
    let rightNum = 1;

    for (let i = 0; i < diff.length; i++) {
        const line = diff[i];
        if (line.type === 'same') {
            rows.push({
                type: 'same',
                left: { type: 'same', content: line.content, num: leftNum++ },
                right: { type: 'same', content: line.content, num: rightNum++ }
            });
        } else if (line.type === 'removed') {
            rows.push({
                type: 'change',
                left: { type: 'removed', content: line.content, num: leftNum++ },
                right: null
            });
        } else if (line.type === 'added') {
            let merged = false;
            for (let j = rows.length - 1; j >= 0; j--) {
                if (rows[j].type === 'same') break;
                if (rows[j].type === 'change' && rows[j].left && !rows[j].right) {
                    rows[j].right = { type: 'added', content: line.content, num: rightNum++ };
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                rows.push({
                    type: 'change',
                    left: null,
                    right: { type: 'added', content: line.content, num: rightNum++ }
                });
            }
        }
    }
    return rows;
}

function filterContextRows(rows, context) {
    if (rows.length === 0) return [];

    const keep = new Array(rows.length).fill(false);

    for (let i = 0; i < rows.length; i++) {
        if (rows[i].type === 'change') {
            keep[i] = true;
            for (let j = 1; j <= context; j++) {
                if (i - j >= 0) keep[i - j] = true;
            }
            for (let j = 1; j <= context; j++) {
                if (i + j < rows.length) keep[i + j] = true;
            }
        }
    }

    const result = [];
    let gapCount = 0;

    for (let i = 0; i < rows.length; i++) {
        if (keep[i]) {
            if (gapCount > 0) {
                result.push({ isGap: true, count: gapCount });
                gapCount = 0;
            }
            result.push(rows[i]);
        } else {
            gapCount++;
        }
    }

    if (gapCount > 0) {
        result.push({ isGap: true, count: gapCount });
    }

    return result;
}

function highlightDifferences(text1, text2) {
    if (!text1 || !text2 || text1 === text2) return { left: escapeHTML(text1), right: escapeHTML(text2) };

    const tokens1 = text1.split(/(\s+|[.,;!?])/);
    const tokens2 = text2.split(/(\s+|[.,;!?])/);

    if (tokens1.length * tokens2.length > 2500) {
        return { left: escapeHTML(text1), right: escapeHTML(text2) };
    }

    const n = tokens1.length;
    const m = tokens2.length;
    const matrix = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (tokens1[i - 1] === tokens2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }

    let i = n, j = m;
    const res1 = [];
    const res2 = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokens1[i - 1] === tokens2[j - 1]) {
            res1.unshift(escapeHTML(tokens1[i - 1]));
            res2.unshift(escapeHTML(tokens2[j - 1]));
            i--; j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            res2.unshift(`<span class="diff-add">${escapeHTML(tokens2[j - 1])}</span>`);
            j--;
        } else {
            res1.unshift(`<span class="diff-rem">${escapeHTML(tokens1[i - 1])}</span>`);
            i--;
        }
    }

    return { left: res1.join(''), right: res2.join('') };
}


window.toggleStructLayer = function (id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';

    if (isHidden) {
        // Was hidden, now showing. Show icon to close (Eye Off)
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                 <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
         `;
        btn.title = "Hide View";
    } else {
        // Was visible, now hidden. Show icon to open (Eye)
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
         `;
        btn.title = "Show View";
    }
};

window.addEventListener('DOMContentLoaded', init);
