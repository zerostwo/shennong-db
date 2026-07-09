#' Plot a gene expression boxplot
#'
#' This helper is intentionally a materialization point: it calls `sn_collect()`
#' with the requested gene and then builds a ggplot.
#'
#' @param .data A lazy Shennong dataset.
#' @param gene Gene or feature to fetch.
#' @param x Column to use on the x axis.
#' @param y Numeric value column.
#' @param limit Maximum rows to fetch.
#' @param ... Additional arguments passed to `sn_collect()`.
#' @return A `ggplot` object.
#' @export
sn_plot_box <- function(.data, gene, x = "group", y = "value", limit = 10000, ...) {
  if (!is.character(gene) || length(gene) != 1L || !nzchar(gene)) {
    rlang::abort("`gene` must be a single non-empty string.")
  }
  df <- sn_collect(.data, features = gene, limit = limit, ...)
  require_columns(df, c(x, y))
  ggplot2::ggplot(df, ggplot2::aes(x = .data[[x]], y = .data[[y]])) +
    ggplot2::geom_boxplot(outlier.alpha = 0.35) +
    ggplot2::labs(x = x, y = y, title = paste(gene, "expression")) +
    ggplot2::theme_minimal(base_size = 12)
}

#' Plot a survival-like curve from collected Shennong rows
#'
#' This helper expects the server response to include time and survival
#' probability columns. More advanced modeling should be routed through
#' `/v1/compute`.
#'
#' @param .data A lazy Shennong dataset.
#' @param time Time column.
#' @param survival Survival probability column.
#' @param group Group column.
#' @param limit Maximum rows to fetch.
#' @param ... Additional arguments passed to `sn_collect()`.
#' @return A `ggplot` object.
#' @export
sn_plot_survival <- function(
  .data,
  time = "month",
  survival = "survival",
  group = "group",
  limit = 10000,
  ...
) {
  df <- sn_collect(.data, fields = c(time, survival, group), limit = limit, measure = "survival", ...)
  require_columns(df, c(time, survival, group))
  ggplot2::ggplot(df, ggplot2::aes(x = .data[[time]], y = .data[[survival]], color = .data[[group]])) +
    ggplot2::geom_step() +
    ggplot2::labs(x = time, y = survival) +
    ggplot2::theme_minimal(base_size = 12)
}

require_columns <- function(data, columns) {
  missing <- setdiff(columns, names(data))
  if (length(missing)) {
    rlang::abort(paste0("Missing required column(s): ", paste(missing, collapse = ", ")))
  }
  invisible(data)
}
