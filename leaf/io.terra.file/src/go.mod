module github.com/StellaxiaLab/modules/leaf/io.terra.file

go 1.25.0

replace github.com/terra-project/terra/products/common/packages/terra-module-sdk => ../../../../products/common/packages/terra-module-sdk

replace github.com/terra-project/terra/products/common/packages/terra-module-runtime => ../../../../products/common/packages/terra-module-runtime

replace github.com/terra-project/terra/products/common/packages/terra-svi => ../../../../products/common/packages/terra-svi

replace github.com/terra-project/terra/products/common/packages/terra-protocol => ../../../../products/common/packages/terra-protocol

require (
	github.com/terra-project/terra/products/common/packages/terra-module-runtime v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-module-sdk v0.0.0-00010101000000-000000000000
)
