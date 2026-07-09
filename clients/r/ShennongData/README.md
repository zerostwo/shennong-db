# ShennongData

`ShennongData` is the R client for Shennong Data Server. It is lazy by
default: `sn_load_data()` only creates a remote dataset handle. Data is fetched
only when `sn_collect()`, `sn_fetch_genes()`, or plotting helpers are called.

```r
library(ShennongData)

sn_set_api_url("http://127.0.0.1:18000")

toil <- sn_load_data("toil")

toil |>
  filter(cancer == "PAAD") |>
  sn_plot_box(gene = "YTHDF2", x = "group")
```

For bounded collection:

```r
rows <- toil |>
  filter(cancer == "PAAD") |>
  sn_collect(features = "YTHDF2", limit = 1000)

attr(rows, "shennong_meta")
```
