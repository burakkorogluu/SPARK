// ============================================
// randomForest.js - Vanilla JS Random Forest (Rastgele Orman) Modülü
// Reaktif Güç Takip ve Analiz Sistemi (İstemci Tarafı ML Algoritmaları)
// ============================================

const RandomForestModulu = (() => {
    'use strict';

    // ─── Karar Ağacı Regresyonu (Decision Tree Regressor) ───
    class DecisionTreeRegressor {
        constructor(maxDepth = 5, minSamplesSplit = 2) {
            this.maxDepth = maxDepth;
            this.minSamplesSplit = minSamplesSplit;
            this.tree = null;
        }

        fit(X, y) {
            this.tree = this.buildTree(X, y, 0);
        }

        buildTree(X, y, depth) {
            const nSamples = X.length;
            if (nSamples >= this.minSamplesSplit && depth < this.maxDepth) {
                const bestSplit = this.getBestSplit(X, y);
                if (bestSplit.varRed > 0) {
                    const leftNode = this.buildTree(bestSplit.X_left, bestSplit.y_left, depth + 1);
                    const rightNode = this.buildTree(bestSplit.X_right, bestSplit.y_right, depth + 1);
                    return {
                        featureIndex: bestSplit.featureIndex,
                        threshold: bestSplit.threshold,
                        left: leftNode,
                        right: rightNode,
                        value: null
                    };
                }
            }
            return { value: this.calculateLeafValue(y) };
        }

        getBestSplit(X, y) {
            let bestSplit = { varRed: -1 };
            if (X.length === 0) return bestSplit;

            const nFeatures = X[0].length;
            const currentVar = this.variance(y);

            // Daha hızlı çalışması için her özelliğin eşsiz (unique) değerlerini bulalım
            for (let featIdx = 0; featIdx < nFeatures; featIdx++) {
                // Hızlı bir threshold seçimi için sadece belirli çeyreklikleri (veya uniq listeyi) alabiliriz
                // Veri setimiz küçük olduğu için tüm unique değerleri test etmek yeterince hızlıdır
                const values = X.map(row => row[featIdx]);
                const uniqueValues = Array.from(new Set(values));

                for (const threshold of uniqueValues) {
                    const { X_left, y_left, X_right, y_right } = this.split(X, y, featIdx, threshold);

                    if (X_left.length > 0 && X_right.length > 0) {
                        const varLeft = this.variance(y_left);
                        const varRight = this.variance(y_right);
                        const weightLeft = y_left.length / y.length;
                        const weightRight = y_right.length / y.length;

                        // Variance Reduction (Varyans Düşüşü - Gini/Information Gain mantığının Regresyon hali)
                        const varRed = currentVar - (weightLeft * varLeft + weightRight * varRight);

                        if (varRed > bestSplit.varRed) {
                            bestSplit = {
                                featureIndex: featIdx,
                                threshold,
                                X_left, y_left, X_right, y_right,
                                varRed
                            };
                        }
                    }
                }
            }
            return bestSplit;
        }

        split(X, y, featureIndex, threshold) {
            const X_left = [], y_left = [], X_right = [], y_right = [];
            for (let i = 0; i < X.length; i++) {
                if (X[i][featureIndex] <= threshold) {
                    X_left.push(X[i]);
                    y_left.push(y[i]);
                } else {
                    X_right.push(X[i]);
                    y_right.push(y[i]);
                }
            }
            return { X_left, y_left, X_right, y_right };
        }

        variance(y) {
            if (y.length === 0) return 0;
            const mean = y.reduce((a, b) => a + b, 0) / y.length;
            return y.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / y.length;
        }

        calculateLeafValue(y) {
            return y.length === 0 ? 0 : y.reduce((a, b) => a + b, 0) / y.length;
        }

        predict(X) {
            return X.map(row => this.makePrediction(row, this.tree));
        }

        makePrediction(row, node) {
            if (node.value !== null) return node.value;
            if (row[node.featureIndex] <= node.threshold) {
                return this.makePrediction(row, node.left);
            } else {
                return this.makePrediction(row, node.right);
            }
        }
    }

    // ─── Random Forest Regressor (Rastgele Orman Regresyonu) ───
    class RandomForestRegressor {
        /**
         * @param {number} nEstimators Oluşturulacak ağaç sayısı
         * @param {number} maxDepth Her bir ağacın maksimum derinliği
         * @param {number} minSamplesSplit Bir düğümün bölünmesi için gereken min örnek sayısı
         */
        constructor(nEstimators = 10, maxDepth = 6, minSamplesSplit = 2) {
            this.nEstimators = nEstimators;
            this.maxDepth = maxDepth;
            this.minSamplesSplit = minSamplesSplit;
            this.trees = [];
        }

        fit(X, y) {
            this.trees = [];
            const nSamples = X.length;

            for (let i = 0; i < this.nEstimators; i++) {
                // Bootstrapping (Rastgele Örneklem Seçimi - yerine koyarak)
                const X_sample = [];
                const y_sample = [];
                for (let j = 0; j < nSamples; j++) {
                    const idx = Math.floor(Math.random() * nSamples);
                    X_sample.push(X[idx]);
                    y_sample.push(y[idx]);
                }

                const tree = new DecisionTreeRegressor(this.maxDepth, this.minSamplesSplit);
                tree.fit(X_sample, y_sample);
                this.trees.push(tree);
            }
        }

        predict(X) {
            const predictions = [];
            for (let i = 0; i < X.length; i++) {
                // Tüm ağaçların tahminini alıp ortalamasını buluyoruz (Bagging)
                const rowPreds = this.trees.map(tree => tree.makePrediction(X[i], tree.tree));
                const mean = rowPreds.reduce((a, b) => a + b, 0) / this.trees.length;
                predictions.push(mean);
            }
            return predictions;
        }
    }

    // Dışarıya Açılan Arayüz
    return {
        RandomForestRegressor
    };
})();
