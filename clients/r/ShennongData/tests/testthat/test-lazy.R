test_that("sn_load_data creates a lazy handle without fetching data", {
  toil <- sn_load_data("toil", api_url = "http://example.test", data_model = "bulk")

  expect_s3_class(toil, "shennong_lazy")
  expect_equal(toil$dataset, "toil")
  expect_equal(toil$api_url, "http://example.test")
  expect_equal(toil$observations, list())
})

test_that("filter records observations for later QuerySpec generation", {
  cancer_groups <- c("Tumor", "Normal")

  toil <- sn_load_data("toil", api_url = "http://example.test", data_model = "bulk") |>
    filter(cancer == "PAAD", group %in% cancer_groups)

  spec <- sn_query_spec(toil, features = "YTHDF2", limit = 200)

  expect_equal(spec$dataset, "toil")
  expect_equal(spec$data_model, "bulk")
  expect_equal(spec$select$features, "YTHDF2")
  expect_equal(spec$select$observations$cancer, "PAAD")
  expect_equal(spec$select$observations$group, cancer_groups)
  expect_equal(spec$options$limit, 200L)
})

test_that("select records fields without materializing rows", {
  toil <- sn_load_data("toil", api_url = "http://example.test") |>
    select(sample_id, cancer, group)

  spec <- sn_query_spec(toil, features = "TP53")

  expect_equal(spec$select$fields, c("sample_id", "cancer", "group"))
})

test_that("range filters map to server lte keys for eQTL queries", {
  eqtl <- sn_load_data(
    "gtex_eqtl",
    api_url = "http://example.test",
    assay = "eqtl",
    data_model = "qtl"
  ) |>
    filter(pvalue <= 0.05)

  spec <- sn_query_spec(eqtl, features = "YTHDF2")

  expect_equal(spec$select$observations$pvalue_lte, "0.05")
})
