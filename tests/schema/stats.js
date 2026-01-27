'use strict'

module.exports = (v) => {
  v.stats_validate.schema.stats.children.hashrate_mhs.children.t_30s.optional = true
  v.stats_validate.schema.stats.children.hashrate_mhs.children.t_30m.optional = true
  v.stats_validate.schema.stats.children.frequency_mhz.children.chips.children.target.optional = true
  v.snap_validate.schema.stats.children = v.stats_validate.schema.stats.children
  return {}
}
