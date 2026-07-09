#' @importFrom dplyr filter
#' @export
dplyr::filter

#' @importFrom dplyr select
#' @export
dplyr::select

#' @importFrom dplyr collect
#' @export
dplyr::collect

#' @method filter shennong_lazy
#' @export
filter.shennong_lazy <- function(.data, ..., .by = NULL, .preserve = FALSE) {
  check_shennong_lazy(.data)
  quos <- rlang::enquos(..., .ignore_empty = "all")
  if (!is.null(.by)) {
    rlang::abort("`.by` is not supported for ShennongData lazy filters.")
  }
  if (!length(quos)) {
    return(.data)
  }

  observations <- .data$observations
  for (quo in quos) {
    parsed <- parse_filter_quo(quo)
    existing <- observations[[parsed$field]]
    values <- as.character(parsed$values)
    observations[[parsed$field]] <- if (is.null(existing)) {
      unique(values)
    } else {
      intersect(as.character(existing), values)
    }
  }
  .data$observations <- observations
  .data
}

#' @method select shennong_lazy
#' @export
select.shennong_lazy <- function(.data, ...) {
  check_shennong_lazy(.data)
  quos <- rlang::enquos(..., .ignore_empty = "all")
  fields <- vapply(quos, symbol_name, character(1))
  .data$fields <- unique(c(.data$fields, fields))
  .data
}

#' @method collect shennong_lazy
#' @export
collect.shennong_lazy <- function(x, ..., n = Inf) {
  limit <- if (is.infinite(n)) NULL else as.integer(n)
  sn_collect(x, ..., limit = limit)
}

parse_filter_quo <- function(quo) {
  expr <- rlang::get_expr(quo)
  env <- rlang::get_env(quo)
  if (!rlang::is_call(expr)) {
    rlang::abort("ShennongData filters must be simple comparisons such as `cancer == \"PAAD\"`.")
  }

  op <- rlang::call_name(expr)
  if (op %in% c("==", "%in%")) {
    lhs <- expr[[2]]
    rhs <- expr[[3]]
    if (rlang::is_symbol(lhs)) {
      field <- rlang::as_string(lhs)
      values <- rlang::eval_tidy(rhs, env = env)
    } else if (op == "==" && rlang::is_symbol(rhs)) {
      field <- rlang::as_string(rhs)
      values <- rlang::eval_tidy(lhs, env = env)
    } else {
      rlang::abort("The left side of a ShennongData filter must be a field name.")
    }
    return(list(field = field, values = values))
  }

  if (op %in% c("<", "<=")) {
    lhs <- expr[[2]]
    rhs <- expr[[3]]
    if (!rlang::is_symbol(lhs)) {
      rlang::abort("Range filters must use a field name on the left side.")
    }
    field <- paste0(rlang::as_string(lhs), "_lte")
    value <- rlang::eval_tidy(rhs, env = env)
    return(list(field = field, values = value))
  }

  rlang::abort(
    paste0(
      "Unsupported ShennongData filter. Use equality, `%in%`, or <= comparisons; got `",
      op,
      "`."
    )
  )
}

symbol_name <- function(quo) {
  expr <- rlang::get_expr(quo)
  if (!rlang::is_symbol(expr)) {
    rlang::abort("ShennongData `select()` currently accepts plain field names only.")
  }
  rlang::as_string(expr)
}
