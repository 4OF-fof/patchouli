/** 読めない形式のときの MediaError の code（MEDIA_ERR_DECODE・MEDIA_ERR_SRC_NOT_SUPPORTED）。 */
export const undecodable = (e: MediaError | null) => e?.code === 3 || e?.code === 4
