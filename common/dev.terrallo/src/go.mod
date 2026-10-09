module github.com/StellaxiaLab/modules/common/dev.terrallo

go 1.23.0

replace github.com/terra-project/terra/products/common/packages/terra-module-sdk => ../../../../products/common/packages/terra-module-sdk

replace github.com/terra-project/terra/products/common/packages/terra-module-runtime => ../../../../products/common/packages/terra-module-runtime

replace github.com/terra-project/terra/products/common/packages/terra-protocol => ../../../../products/common/packages/terra-protocol

replace github.com/terra-project/terra/products/common/packages/terra-svi => ../../../../products/common/packages/terra-svi

require (
	github.com/terra-project/terra/products/common/packages/terra-module-runtime v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-module-sdk v0.0.0
)
