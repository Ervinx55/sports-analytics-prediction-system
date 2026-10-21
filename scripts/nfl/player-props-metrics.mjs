export function metrics(rows, predictionFn = (row) => row.prediction) {
  if (!rows.length) {
    return {
      rows: 0,
      mae: null,
      rmse: null,
      bias: null,
      baselineRows: 0,
      baselineMae: null,
      pairedRows: 0,
      pairedModelMae: null,
      pairedBaselineMae: null,
      maeImprovementVsRollingMean: null
    };
  }

  let absolute = 0;
  let squared = 0;
  let signed = 0;
  let modelRows = 0;
  let baselineAbsolute = 0;
  let baselineRows = 0;
  let pairedModelAbsolute = 0;
  let pairedBaselineAbsolute = 0;
  let pairedRows = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.actual)) continue;
    const prediction = predictionFn(row);
    if (Number.isFinite(prediction)) {
      const error = prediction - row.actual;
      absolute += Math.abs(error);
      squared += error ** 2;
      signed += error;
      modelRows += 1;
    }

    if (Number.isFinite(row.baseline)) {
      baselineAbsolute += Math.abs(row.baseline - row.actual);
      baselineRows += 1;
      if (Number.isFinite(prediction)) {
        pairedModelAbsolute += Math.abs(prediction - row.actual);
        pairedBaselineAbsolute += Math.abs(row.baseline - row.actual);
        pairedRows += 1;
      }
    }
  }

  const mae = modelRows > 0 ? absolute / modelRows : null;
  const baselineMae =
    baselineRows > 0 ? baselineAbsolute / baselineRows : null;
  const pairedModelMae =
    pairedRows > 0 ? pairedModelAbsolute / pairedRows : null;
  const pairedBaselineMae =
    pairedRows > 0 ? pairedBaselineAbsolute / pairedRows : null;

  return {
    rows: modelRows,
    mae,
    rmse: modelRows > 0 ? Math.sqrt(squared / modelRows) : null,
    bias: modelRows > 0 ? signed / modelRows : null,
    baselineRows,
    baselineMae,
    pairedRows,
    pairedModelMae,
    pairedBaselineMae,
    maeImprovementVsRollingMean:
      pairedRows === 0
        ? null
        : pairedBaselineMae - pairedModelMae
  };
}
