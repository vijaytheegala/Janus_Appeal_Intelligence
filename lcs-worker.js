self.addEventListener('message', (e) => {
    const { id, textA, textB } = e.data;

    function computeLCS(text1, text2) {
        const lines1 = text1.split(/\r?\n/);
        const lines2 = text2.split(/\r?\n/);
        const n = lines1.length;
        const m = lines2.length;
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

    const result = computeLCS(textA || '', textB || '');
    self.postMessage({ id, result });
});
