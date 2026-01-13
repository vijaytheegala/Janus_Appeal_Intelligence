const AdvancedComparison = {
    compare: async function (doc1, doc2) {
        const textDiff = this.layers.textDiff.run(doc1.content, doc2.content);
        const jaccardScore = this.layers.textDiff.jaccardIndex(doc1.content, doc2.content);
        const structDiff = this.layers.structured.run(doc1.content, doc2.content);
        const imageDiff = await this.layers.image.run(doc1.images, doc2.images);
        const metaDiff = this.layers.meta.run(doc1, doc2);

        let weightedScore = 0;
        let diffDetails = {
            text: textDiff,
            structure: structDiff,
            images: imageDiff,
            meta: metaDiff,
            jaccard: jaccardScore
        };

        const hasImages = (doc1.images && doc1.images.length > 0) || (doc2.images && doc2.images.length > 0);

        let effectiveTextScore = textDiff.stats.matchPercent;
        if (jaccardScore > 85 && textDiff.stats.matchPercent < 70) {
            effectiveTextScore = (jaccardScore * 0.8) + (textDiff.stats.matchPercent * 0.2);
        } else {
            effectiveTextScore = (textDiff.stats.matchPercent * 0.7) + (jaccardScore * 0.3);
        }

        if (hasImages) {
            weightedScore = (effectiveTextScore * 0.50) +
                (imageDiff.matchPercent * 0.20) +
                (structDiff.matchPercent * 0.15) +
                (metaDiff.matchPercent * 0.15);
        } else {
            weightedScore = (effectiveTextScore * 0.60) +
                (structDiff.matchPercent * 0.20) +
                (metaDiff.matchPercent * 0.20);
        }

        return {
            matchPercent: Math.round(weightedScore),
            details: diffDetails
        };
    },

    layers: {
        textDiff: {
            run: function (text1, text2) {
                return computeTextDiff(text1, text2);
            },

            jaccardIndex: function (text1, text2) {
                const set1 = new Set(text1.toLowerCase().split(/\s+/));
                const set2 = new Set(text2.toLowerCase().split(/\s+/));
                const intersection = new Set([...set1].filter(x => set2.has(x)));
                const union = new Set([...set1, ...set2]);
                return Math.round((intersection.size / union.size) * 100);
            },
        },

        structured: {
            run: function (text1, text2) {
                const data1 = this.extract(text1);
                const data2 = this.extract(text2);
                return this.compareSets(data1, data2);
            },
            extract: function (text) {
                const patterns = {
                    dates: /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,
                    emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
                    amounts: /\$\d{1,3}(,\d{3})*(\.\d{2})?|\b\d{1,3}(,\d{3})*(\.\d{2})?\s?(USD|EUR|GBP)\b/g,
                    phones: /\b\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g
                };

                let captured = { dates: [], emails: [], amounts: [], phones: [] };

                for (let key in patterns) {
                    const matches = text.match(patterns[key]) || [];
                    captured[key] = matches.map(s => s.trim());
                }
                return captured;
            },
            compareSets: function (data1, data2) {
                let totalItems = 0;
                let matches = 0;
                let mismatches = [];

                for (let key in data1) {
                    const set1 = data1[key];
                    const set2 = data2[key];

                    const map1 = this.countMap(set1);
                    const map2 = this.countMap(set2);

                    const uniqueKeys = new Set([...Object.keys(map1), ...Object.keys(map2)]);

                    uniqueKeys.forEach(val => {
                        const c1 = map1[val] || 0;
                        const c2 = map2[val] || 0;
                        const max = Math.max(c1, c2);
                        const min = Math.min(c1, c2);

                        totalItems += max;
                        matches += min;

                        if (c1 !== c2) {
                            mismatches.push({
                                type: key,
                                value: val,
                                count1: c1,
                                count2: c2
                            });
                        }
                    });
                }

                const percent = totalItems === 0 ? 100 : Math.round((matches / totalItems) * 100);
                return { matchPercent: percent, mismatches };
            },
            countMap: function (arr) {
                let m = {};
                arr.forEach(x => m[x] = (m[x] || 0) + 1);
                return m;
            }
        },

        image: {
            run: async function (imgs1, imgs2) {
                if (!imgs1) imgs1 = [];
                if (!imgs2) imgs2 = [];

                if (imgs1.length === 0 && imgs2.length === 0) {
                    return { matchPercent: 100, diffs: [] };
                }

                let matches = 0;
                let diffs = [];

                const used2 = new Set();

                for (let i = 0; i < imgs1.length; i++) {
                    const img1 = imgs1[i];
                    let bestMatch = null;
                    let bestScore = 0;
                    let bestIndices = -1;

                    for (let j = 0; j < imgs2.length; j++) {
                        if (used2.has(j)) continue;
                        const img2 = imgs2[j];

                        const similarity = await this.comparePixels(img1, img2);
                        if (similarity > bestScore) {
                            bestScore = similarity;
                            bestMatch = j;
                        }
                    }

                    if (bestMatch !== null && bestScore > 0.9) {
                        matches++;
                        used2.add(bestMatch);
                    } else {
                        diffs.push({ side: 'left', index: i, src: img1 });
                    }
                }

                for (let j = 0; j < imgs2.length; j++) {
                    if (!used2.has(j)) {
                        diffs.push({ side: 'right', index: j, src: imgs2[j] });
                    }
                }

                const maxCount = Math.max(imgs1.length, imgs2.length);
                const percent = maxCount === 0 ? 100 : Math.round((matches / maxCount) * 100);

                return { matchPercent: percent, diffs };
            },

            comparePixels: function (src1, src2) {
                return new Promise((resolve) => {
                    const i1 = new Image();
                    const i2 = new Image();
                    let loaded = 0;
                    const onData = () => {
                        loaded++;
                        if (loaded === 2) compare();
                    };
                    i1.onload = onData;
                    i2.onload = onData;
                    i1.src = src1;
                    i2.src = src2;

                    function compare() {
                        if (i1.width !== i2.width || i1.height !== i2.height) {
                            resolve(0);
                            return;
                        }

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const w = i1.width;
                        const h = i1.height;
                        canvas.width = w;
                        canvas.height = h;

                        ctx.drawImage(i1, 0, 0);
                        const d1 = ctx.getImageData(0, 0, w, h).data;

                        ctx.clearRect(0, 0, w, h);
                        ctx.drawImage(i2, 0, 0);
                        const d2 = ctx.getImageData(0, 0, w, h).data;

                        let diffPixels = 0;
                        for (let i = 0; i < d1.length; i += 4) {
                            if (Math.abs(d1[i] - d2[i]) > 10 ||
                                Math.abs(d1[i + 1] - d2[i + 1]) > 10 ||
                                Math.abs(d1[i + 2] - d2[i + 2]) > 10) {
                                diffPixels++;
                            }
                        }
                        const totalPixels = w * h;
                        resolve(1 - (diffPixels / totalPixels));
                    }
                });
            }
        },

        meta: {
            run: function (doc1, doc2) {
                const diffs = [];
                let matchCount = 0;
                let totalChecks = 0;

                totalChecks++;
                const sizeDiff = Math.abs(doc1.size - doc2.size);
                const sizeRatio = sizeDiff / Math.max(doc1.size, doc2.size || 1);

                if (sizeRatio < 0.05) matchCount++;
                else {
                    diffs.push({ key: 'File Size', val1: this.formatBytes(doc1.size), val2: this.formatBytes(doc2.size) });
                }

                totalChecks++;
                const wc1 = doc1.content.split(/\s+/).length;
                const wc2 = doc2.content.split(/\s+/).length;
                const wcDiffPct = Math.abs(wc1 - wc2) / Math.max(wc1, wc2 || 1);

                if (wcDiffPct < 0.05) matchCount++;
                else {
                    diffs.push({ key: 'Word Count', val1: wc1, val2: wc2 });
                }

                totalChecks++;
                if (doc1.type === doc2.type) matchCount++;
                else {
                }

                const percent = Math.round((matchCount / totalChecks) * 100);
                return { matchPercent: percent, diffs };
            },
            formatBytes: function (bytes, decimals = 2) {
                if (!+bytes) return '0 Bytes';
                const k = 1024;
                const dm = decimals < 0 ? 0 : decimals;
                const sizes = ['Bytes', 'KB', 'MB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
            }
        }
    }
};

function computeTextDiff(text1, text2) {
    const lines1 = text1.split(/\r?\n/);
    const lines2 = text2.split(/\r?\n/);

    const n = lines1.length;
    const m = lines2.length;

    if (n * m > 5000000) {
        return computeApproximate(lines1, lines2);
    }

    const matrix = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));

    const normalize = s => s.trim().replace(/\s+/g, ' ');

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (normalize(lines1[i - 1]) === normalize(lines2[j - 1])) {
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
        // Use normalized comparison for "same" detection
        if (i > 0 && j > 0 && normalize(lines1[i - 1]) === normalize(lines2[j - 1])) {
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

    return {
        diff,
        stats: {
            matchPercent: percent,
            added: diff.filter(l => l.type === 'added').length,
            removed: diff.filter(l => l.type === 'removed').length,
            matching: matchingLines
        }
    };
}

function computeApproximate(lines1, lines2) {
    const set1 = new Set(lines1);
    const set2 = new Set(lines2);
    let intersection = 0;

    if (set1.size <= set2.size) {
        for (const l of set1) if (set2.has(l)) intersection++;
    } else {
        for (const l of set2) if (set1.has(l)) intersection++;
    }

    const maxLen = Math.max(lines1.length, lines2.length) || 1;
    const percent = Math.round((intersection / maxLen) * 100);

    return {
        approx: true,
        diff: [],
        stats: {
            matchPercent: percent,
            added: Math.max(0, lines2.length - intersection),
            removed: Math.max(0, lines1.length - intersection),
            matching: intersection
        }
    };
}
